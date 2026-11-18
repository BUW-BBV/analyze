import { Database } from "bun:sqlite";
import * as XLSX from "xlsx";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, isAbsolute, sep } from "node:path";
import { authenticate, LOGOUT_URL, SERVER_MODE, type User } from "./auth";
import { parseWorkbook } from "./sheets";
import { HttpError, listTree, mimeOf, readBytes, resolveV, treeStats, type TreeNode } from "./files";

const APP_ROOT = resolve(import.meta.dir, "..");
// On the server these come from the environment; locally the defaults next to the app are used.
const DATA_DIR = process.env.DATA_DIR ?? join(APP_ROOT, "data");
const PROVIDERS_FILE = process.env.PROVIDERS_FILE ?? join(APP_ROOT, "providers.json");
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
const DIST = join(APP_ROOT, "dist");
const PDFJS = join(APP_ROOT, "node_modules", "pdfjs-dist");
const PORT = Number(process.env.PORT ?? 3210);

mkdirSync(DATA_DIR, { recursive: true });

// ---------- providers ----------
type Provider = { id: string; name: string; root: string };

function loadProviders(): Provider[] {
  if (!existsSync(PROVIDERS_FILE)) {
    const initial: Provider[] = [{ id: "example", name: "Example provider", root: "../documents" }];
    writeFileSync(PROVIDERS_FILE, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(readFileSync(PROVIDERS_FILE, "utf8"));
}
const rootOf = (p: Provider) => (isAbsolute(p.root) ? p.root : resolve(APP_ROOT, p.root));

function getProvider(id: string | null): Provider {
  const p = loadProviders().find((x) => x.id === id);
  if (!p) throw new HttpError(404, `Unknown provider "${id}"`);
  return p;
}

// ---------- database ----------
const db = new Database(join(DATA_DIR, "analyzer.db"), { create: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS projects (
    provider TEXT NOT NULL, folder TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL,
    PRIMARY KEY (provider, folder)
  );
  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, project TEXT NOT NULL, file TEXT NOT NULL,
    kind TEXT NOT NULL, page INTEGER, anchor TEXT, quote TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'yellow', tags TEXT NOT NULL DEFAULT '[]',
    created INTEGER NOT NULL, updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS anno_file ON annotations (provider, file);
  CREATE TABLE IF NOT EXISTS details (
    kind TEXT NOT NULL, provider TEXT NOT NULL, path TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (kind, provider, path)
  );
  CREATE TABLE IF NOT EXISTS views (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS file_tags (
    provider TEXT NOT NULL, file TEXT NOT NULL, tags TEXT NOT NULL,
    PRIMARY KEY (provider, file)
  );
`);

// Qualitative content analysis (Mayring): studies, their category systems, and the material.
db.exec(`
  CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, analysis TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS material (
    analysis TEXT NOT NULL, provider TEXT NOT NULL, file TEXT NOT NULL, state TEXT NOT NULL,
    PRIMARY KEY (analysis, provider, file)
  );
`);
// A coded segment is an annotation with a category of one analysis.
const CODING = ["analysis", "category", "paraphrase", "generalization", "reduction"] as const;
try {
  db.exec("ALTER TABLE annotations ADD COLUMN author TEXT NOT NULL DEFAULT ''");
} catch {
  /* column exists */
}
for (const col of CODING) {
  try {
    db.exec(`ALTER TABLE annotations ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column exists */
  }
}

const annoOut = (r: any) => ({ ...r, anchor: r.anchor ? JSON.parse(r.anchor) : null, tags: JSON.parse(r.tags) });

// ---------- project register (provider-level Excel listing the projects) ----------
const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

function parseFolder(folder: string) {
  const m = folder.match(/^(A\.?\d[\d.]*\d)[\s_\-–,]*(.*)$/);
  return m ? { number: m[1], title: m[2].replaceAll("_", " ").trim() || folder } : { number: "", title: folder };
}

const registerCache = new Map<string, Record<string, string>[]>();
async function readRegister(root: string, files: TreeNode[]): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for (const f of files) {
    if (f.type !== "file" || !/\.xls[xm]?$/i.test(f.name)) continue;
    const key = `${root}/${f.name}@${f.mtime}`;
    let parsed = registerCache.get(key);
    if (!parsed) {
      parsed = [];
      try {
        const wb = XLSX.read(await Bun.file(join(root, f.name)).arrayBuffer());
        for (const name of wb.SheetNames) {
          const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" }) as string[][];
          const h = grid.findIndex((r) => r.some((c) => /projektnummer/i.test(String(c))));
          if (h < 0) continue;
          const head = grid[h].map((c) => String(c).trim());
          for (const r of grid.slice(h + 1)) {
            const row: Record<string, string> = {};
            head.forEach((k, i) => {
              const v = String(r[i] ?? "").trim();
              if (k && v) row[k] = v;
            });
            if (Object.keys(row).length) parsed.push(row);
          }
        }
      } catch {
        /* not a readable register */
      }
      registerCache.set(key, parsed);
    }
    rows.push(...parsed);
  }
  return rows;
}

function matchRegister(rows: Record<string, string>[], number: string) {
  const d = digits(number);
  if (d.length < 4) return null;
  return (
    rows.find((r) => {
      const k = Object.keys(r).find((x) => /projektnummer/i.test(x));
      const rd = k ? digits(r[k]) : "";
      return rd.length >= 4 && (rd.startsWith(d) || d.startsWith(rd));
    }) ?? null
  );
}

/** Saved details, filled up from the provider's project list and the folder name. */
function resolveDetails(folder: string, saved: any, reg: Record<string, string> | null) {
  const parsed = parseFolder(folder);
  const find = (re: RegExp) => {
    const k = reg && Object.keys(reg).find((x) => re.test(x));
    return k ? reg![k] : "";
  };
  const d = saved ?? {};
  return {
    number: d.number ?? parsed.number,
    title: d.title ?? (find(/bezeichnung/i) || parsed.title),
    branch: d.branch ?? find(/^nl\b|niederlassung/i),
    contract: d.contract ?? find(/vertragsnummer/i),
    road: d.road ?? (`${folder} ${find(/bezeichnung/i)}`.match(/(?:^|[\s_])(A\s?\d{1,3})(?=[\s_,]|$)/)?.[1] ?? ""),
    phases: d.phases ?? "",
    status: d.status ?? "Not started",
    summary: d.summary ?? "",
    notes: d.notes ?? "",
    custom: d.custom ?? [],
  };
}

async function providerOverview(p: Provider) {
  const root = rootOf(p);
  if (!existsSync(root)) return { ...p, error: `Folder not found: ${root}`, projects: [], files: [] };
  const top = await listTree(root, "");
  const files = top.filter((n) => n.type === "file");
  const register = await readRegister(root, files);
  const saved = new Map(
    (db.query("SELECT folder, data FROM projects WHERE provider = ?").all(p.id) as any[]).map((r) => [
      r.folder,
      JSON.parse(r.data),
    ]),
  );
  const projects = top
    .filter((n) => n.type === "dir")
    .map((n) => {
      const reg = matchRegister(register, parseFolder(n.name).number);
      const details = resolveDetails(n.name, saved.get(n.name), reg);
      return {
        folder: n.name,
        number: details.number,
        title: details.title,
        status: details.status,
        details,
        register: reg,
        ...treeStats(n.children ?? []),
      };
    });
  return { ...p, root, projects, files, hasRegister: register.length > 0 };
}

// ---------- http helpers ----------
const json = (data: unknown, status = 200) => Response.json(data, { status });

function serveBytes(req: Request, body: Uint8Array | ReturnType<typeof Bun.file>, size: number, name: string, download: boolean) {
  const headers: Record<string, string> = {
    "Content-Type": mimeOf(name),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const part = body instanceof Uint8Array ? body.subarray(start, end + 1) : body.slice(start, end + 1);
    return new Response(part as any, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(body as any, { headers: { ...headers, "Content-Length": String(size) } });
}

async function staticFile(base: string, rel: string): Promise<Response | null> {
  const full = resolve(base, "." + rel);
  if (!full.startsWith(base + sep)) return null;
  const st = await stat(full).catch(() => null);
  if (!st?.isFile()) return null;
  return new Response(Bun.file(full));
}

const csvCell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;

// ---------- routes ----------
async function handle(req: Request, user: User): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const path = url.pathname;
  const method = req.method;

  if (method !== "GET" && method !== "HEAD") {
    if (user.role === "viewer") throw new HttpError(403, "Your account can read but not change anything.");
    // A browser sends the page's origin with every change; anything else is another site acting for the user.
    const origin = req.headers.get("origin");
    if (PUBLIC_URL && origin && origin !== PUBLIC_URL) throw new HttpError(403, "Request from another site refused");
  }

  if (path === "/api/me" && method === "GET") {
    return json({ ...user, logoutUrl: LOGOUT_URL && `/oauth2/sign_out?rd=${encodeURIComponent(`${LOGOUT_URL}?client_id=${process.env.OIDC_AUDIENCE ?? "analyzer"}&post_logout_redirect_uri=${encodeURIComponent(PUBLIC_URL + "/")}`)}` });
  }

  if (path === "/api/providers" && method === "GET") {
    return json(await Promise.all(loadProviders().map(providerOverview)));
  }

  if (path === "/api/providers" && method === "POST") {
    // Adding a provider means pointing the app at any folder on the machine. Only for local use.
    if (SERVER_MODE) throw new HttpError(403, "Providers are set up by the administrator on the server.");
    const body = (await req.json()) as { name?: string; root?: string };
    const name = body.name?.trim();
    const root = body.root?.trim().replace(/^"|"$/g, "");
    if (!name || !root) throw new HttpError(400, "Name and folder are required");
    if (!isAbsolute(root)) throw new HttpError(400, "Enter the full folder path, for example C:\\Data\\Provider");
    const st = await stat(root).catch(() => null);
    if (!st?.isDirectory()) throw new HttpError(400, `Folder not found: ${root}`);
    const all = loadProviders();
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "provider";
    while (all.some((p) => p.id === id)) id += "-2";
    all.push({ id, name, root });
    writeFileSync(PROVIDERS_FILE, JSON.stringify(all, null, 2));
    return json({ id });
  }

  if (path === "/api/tree" && method === "GET") {
    const p = getProvider(q.get("provider"));
    return json(await listTree(rootOf(p), q.get("path") ?? ""));
  }

  if (path === "/api/file" && method === "GET") {
    const p = getProvider(q.get("provider"));
    const vpath = q.get("path") ?? "";
    const r = await resolveV(rootOf(p), vpath);
    const name = vpath.split("/").pop() || "file";
    const download = q.get("download") === "1";
    if (r.kind === "file") return serveBytes(req, Bun.file(r.real), r.size, name, download);
    if (r.kind === "mem") return serveBytes(req, r.data, r.data.length, name, download);
    throw new HttpError(400, "Not a file");
  }

  if (path === "/api/sheet" && method === "GET") {
    const p = getProvider(q.get("provider"));
    const r = await resolveV(rootOf(p), q.get("path") ?? "");
    if (r.kind !== "file" && r.kind !== "mem") throw new HttpError(400, "Not a file");
    return json(await parseWorkbook(r.key, await readBytes(r), q.get("path") ?? ""));
  }

  if (path === "/api/open" && method === "POST") {
    if (SERVER_MODE) throw new HttpError(403, "Not available on the server");
    const body = (await req.json()) as { provider: string; path: string; reveal?: boolean };
    const p = getProvider(body.provider);
    const r = await resolveV(rootOf(p), body.path);
    if (r.kind !== "file" && r.kind !== "dir") throw new HttpError(400, "Files inside archives cannot be opened directly. Download the file instead.");
    if (process.platform !== "win32") throw new HttpError(501, "Only available on Windows");
    Bun.spawn(["explorer.exe", body.reveal ? `/select,${r.real}` : r.real], { stdio: ["ignore", "ignore", "ignore"] });
    return json({ ok: true });
  }

  if (path === "/api/project") {
    const p = getProvider(q.get("provider"));
    const folder = q.get("folder") ?? "";
    const root = rootOf(p);
    const r = await resolveV(root, folder);
    if (r.kind !== "dir" || !folder || folder.includes("/")) throw new HttpError(404, "Project not found");
    if (method === "GET") {
      const row = db.query("SELECT data, updated FROM projects WHERE provider = ? AND folder = ?").get(p.id, folder) as any;
      const top = (await listTree(root, "")).filter((n) => n.type === "file");
      const parsed = parseFolder(folder);
      const register = matchRegister(await readRegister(root, top), parsed.number);
      return json({ folder, parsed, register, details: row ? JSON.parse(row.data) : null, updated: row?.updated ?? null });
    }
    if (method === "PUT") {
      const now = Date.now();
      db.query(
        "INSERT INTO projects (provider, folder, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT (provider, folder) DO UPDATE SET data = excluded.data, updated = excluded.updated",
      ).run(p.id, folder, JSON.stringify(await req.json()), now);
      return json({ updated: now });
    }
  }

  if (path === "/api/annotations" && method === "GET") {
    return json((db.query("SELECT * FROM annotations ORDER BY created").all() as any[]).map(annoOut));
  }

  if (path === "/api/annotations" && method === "POST") {
    const b = (await req.json()) as any;
    getProvider(b.provider);
    if (!b.file || !b.kind) throw new HttpError(400, "file and kind are required");
    const now = Date.now();
    const id = crypto.randomUUID();
    db.query(
      "INSERT INTO annotations (id, provider, project, file, kind, page, anchor, quote, comment, color, tags, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(id, b.provider, b.project ?? "", b.file, b.kind, b.page ?? null, b.anchor ? JSON.stringify(b.anchor) : null, b.quote ?? "", b.comment ?? "", b.color ?? "yellow", JSON.stringify(b.tags ?? []), now, now);
    db.query("UPDATE annotations SET analysis = ?, category = ?, paraphrase = ?, generalization = ?, reduction = ?, author = ? WHERE id = ?").run(
      ...CODING.map((c) => String(b[c] ?? "")),
      user.local ? "" : user.email || user.name,
      id,
    );
    return json(annoOut(db.query("SELECT * FROM annotations WHERE id = ?").get(id)));
  }

  const am = path.match(/^\/api\/annotations\/([\w-]+)$/);
  if (am && method === "PUT") {
    const b = (await req.json()) as any;
    const cur = db.query("SELECT * FROM annotations WHERE id = ?").get(am[1]) as any;
    if (!cur) throw new HttpError(404, "Annotation not found");
    db.query(
      "UPDATE annotations SET comment = ?, color = ?, tags = ?, analysis = ?, category = ?, paraphrase = ?, generalization = ?, reduction = ?, updated = ? WHERE id = ?",
    ).run(
      b.comment ?? cur.comment,
      b.color ?? cur.color,
      b.tags ? JSON.stringify(b.tags) : cur.tags,
      ...CODING.map((c) => String(b[c] ?? cur[c] ?? "")),
      Date.now(),
      am[1],
    );
    return json(annoOut(db.query("SELECT * FROM annotations WHERE id = ?").get(am[1])));
  }
  if (am && method === "DELETE") {
    db.query("DELETE FROM annotations WHERE id = ?").run(am[1]);
    return json({ ok: true });
  }

  if (path === "/api/qia" && method === "GET") {
    return json({
      analyses: (db.query("SELECT id, data FROM analyses ORDER BY created").all() as any[]).map((r) => ({ ...JSON.parse(r.data), id: r.id })),
      categories: (db.query("SELECT id, analysis, data FROM categories").all() as any[]).map((r) => ({ ...JSON.parse(r.data), id: r.id, analysis: r.analysis })),
      material: db.query("SELECT analysis, provider, file, state FROM material").all(),
    });
  }

  if (path === "/api/qia/analysis" && method === "PUT") {
    const { id: given, ...data } = (await req.json()) as any;
    if (!String(data.name ?? "").trim()) throw new HttpError(400, "An analysis needs a name");
    const id = given ?? crypto.randomUUID();
    db.query("INSERT INTO analyses (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data").run(id, JSON.stringify(data), Date.now());
    return json({ ...data, id });
  }

  if (path === "/api/qia/category" && method === "PUT") {
    const { id: given, analysis, ...data } = (await req.json()) as any;
    if (!analysis || !String(data.name ?? "").trim()) throw new HttpError(400, "A category needs a name");
    const id = given ?? crypto.randomUUID();
    db.query("INSERT INTO categories (id, analysis, data) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data").run(id, analysis, JSON.stringify(data));
    return json({ ...data, id, analysis });
  }

  if (path === "/api/qia/material" && method === "PUT") {
    const b = (await req.json()) as { analysis: string; provider: string; file: string; state: string };
    if (b.state) {
      db.query("INSERT INTO material (analysis, provider, file, state) VALUES (?, ?, ?, ?) ON CONFLICT (analysis, provider, file) DO UPDATE SET state = excluded.state").run(b.analysis, b.provider, b.file, b.state);
    } else db.query("DELETE FROM material WHERE analysis = ? AND provider = ? AND file = ?").run(b.analysis, b.provider, b.file);
    return json({ ok: true });
  }

  const qm = path.match(/^\/api\/qia\/(analysis|category)\/([\w-]+)$/);
  if (qm && method === "DELETE") {
    if (qm[1] === "analysis") {
      db.query("DELETE FROM analyses WHERE id = ?").run(qm[2]);
      db.query("DELETE FROM categories WHERE analysis = ?").run(qm[2]);
      db.query("DELETE FROM material WHERE analysis = ?").run(qm[2]);
      // the marked passages stay as plain annotations
      db.query("UPDATE annotations SET analysis = '', category = '' WHERE analysis = ?").run(qm[2]);
    } else {
      db.query("DELETE FROM categories WHERE id = ?").run(qm[2]);
      db.query("UPDATE annotations SET category = '' WHERE category = ?").run(qm[2]);
    }
    return json({ ok: true });
  }

  if (path === "/api/details" && method === "GET") {
    return json((db.query("SELECT kind, provider, path, data FROM details").all() as any[]).map((r) => ({ ...r, data: JSON.parse(r.data) })));
  }

  if (path === "/api/details" && method === "PUT") {
    const b = (await req.json()) as { kind: string; provider: string; path: string; data: unknown };
    getProvider(b.provider);
    if (b.kind !== "provider" && b.kind !== "document") throw new HttpError(400, "Unknown kind");
    db.query(
      "INSERT INTO details (kind, provider, path, data) VALUES (?, ?, ?, ?) ON CONFLICT (kind, provider, path) DO UPDATE SET data = excluded.data",
    ).run(b.kind, b.provider, b.path ?? "", JSON.stringify(b.data ?? {}));
    return json({ ok: true });
  }

  if (path === "/api/views" && method === "GET") {
    return json((db.query("SELECT id, kind, name, config FROM views ORDER BY created").all() as any[]).map((r) => ({ ...r, config: JSON.parse(r.config) })));
  }

  if (path === "/api/views" && method === "PUT") {
    const b = (await req.json()) as { id?: string; kind: string; name: string; config: unknown };
    if (!b.kind || !b.name?.trim()) throw new HttpError(400, "A view needs a name");
    const id = b.id ?? crypto.randomUUID();
    db.query(
      "INSERT INTO views (id, kind, name, config, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, config = excluded.config",
    ).run(id, b.kind, b.name.trim(), JSON.stringify(b.config ?? {}), Date.now());
    return json({ id, kind: b.kind, name: b.name.trim(), config: b.config ?? {} });
  }

  const vm = path.match(/^\/api\/views\/([\w-]+)$/);
  if (vm && method === "DELETE") {
    db.query("DELETE FROM views WHERE id = ?").run(vm[1]);
    return json({ ok: true });
  }

  if (path === "/api/filetags" && method === "GET") {
    return json((db.query("SELECT provider, file, tags FROM file_tags").all() as any[]).map((r) => ({ ...r, tags: JSON.parse(r.tags) })));
  }

  if (path === "/api/filetags" && method === "PUT") {
    const b = (await req.json()) as { provider: string; file: string; tags: string[] };
    getProvider(b.provider);
    const tags = [...new Set((b.tags ?? []).map((t) => String(t).trim()).filter(Boolean))];
    if (!b.file) throw new HttpError(400, "file is required");
    if (tags.length) {
      db.query("INSERT INTO file_tags (provider, file, tags) VALUES (?, ?, ?) ON CONFLICT (provider, file) DO UPDATE SET tags = excluded.tags").run(b.provider, b.file, JSON.stringify(tags));
    } else db.query("DELETE FROM file_tags WHERE provider = ? AND file = ?").run(b.provider, b.file);
    return json({ tags });
  }

  if (path === "/api/export" && method === "GET") {
    const p = getProvider(q.get("provider"));
    const project = q.get("project") ?? "";
    const rows = db
      .query("SELECT * FROM annotations WHERE provider = ? AND (? = '' OR project = ?) ORDER BY project, file, page, created")
      .all(p.id, project, project) as any[];
    const head = ["Project", "File", "Page", "Kind", "Location", "Quote", "Comment", "Tags", "Color", "Created"];
    const lines = rows.map((r) => {
      const a = r.anchor ? JSON.parse(r.anchor) : {};
      const loc = r.kind === "cell" ? `${a.sheet}!${a.ref}` : "";
      return [r.project, r.file, r.page ?? "", r.kind, loc, r.quote, r.comment, JSON.parse(r.tags).join(", "), r.color, new Date(r.created).toISOString()]
        .map(csvCell)
        .join(";");
    });
    const csv = "\uFEFF" + [head.map(csvCell).join(";"), ...lines].join("\r\n");
    const fname = `annotations-${p.id}${project ? "-" + parseFolder(project).number : ""}.csv`;
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}` },
    });
  }

  if (path.startsWith("/api/")) throw new HttpError(404, "Unknown endpoint");

  if (path.startsWith("/pdfjs/")) {
    const res = await staticFile(PDFJS, path.slice("/pdfjs".length));
    if (res) {
      res.headers.set("Cache-Control", "public, max-age=86400");
      return res;
    }
    return new Response("Not found", { status: 404 });
  }

  // built client (production)
  if (existsSync(DIST)) {
    return (await staticFile(DIST, path === "/" ? "/index.html" : path)) ?? new Response(Bun.file(join(DIST, "index.html")));
  }
  return new Response("Client not built. Run `bun run dev` for development or `bun run start`.", { status: 404 });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // pdf.js needs WebAssembly and a worker; documents and spreadsheets use inline styles.
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
if (SERVER_MODE) SECURITY_HEADERS["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

function secured(res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 60,
  async fetch(req) {
    try {
      return secured(await handle(req, await authenticate(req)));
    } catch (e) {
      if (e instanceof HttpError) return secured(json({ error: e.message }, e.status));
      console.error(e);
      return secured(json({ error: SERVER_MODE ? "Server error" : ((e as Error).message ?? "Server error") }, 500));
    }
  },
});

console.log(`Analyzer server on http://${HOST}:${server.port} (${SERVER_MODE ? "server mode, sign-in required" : "local mode"})`);
