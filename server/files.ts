// Virtual file system: real folders plus transparent access into (nested) zip archives.
// A virtual path looks like "Project/Sub/archive.zip/inner/file.pdf".
import { unzipSync } from "fflate";
import { readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
  zip?: boolean;
  children?: TreeNode[];
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const CP850 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (!utf8Flag) {
    // Many tools write UTF-8 without setting the flag, so try that first.
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      let s = "";
      for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP850[b - 0x80];
      return s;
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Entry names from the central directory, in order, decoded with the right code page. */
function readZipNames(buf: Uint8Array): string[] | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || off === 0xffffffff) return null; // zip64: fall back
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || dv.getUint32(off, true) !== 0x02014b50) return null;
    const flag = dv.getUint16(off + 8, true);
    const n = dv.getUint16(off + 28, true);
    const e = dv.getUint16(off + 30, true);
    const c = dv.getUint16(off + 32, true);
    names.push(decodeName(buf.subarray(off + 46, off + 46 + n), (flag & 0x800) !== 0));
    off += 46 + n + e + c;
  }
  return names;
}

type Zip = { entries: Map<string, Uint8Array>; dirs: Set<string> };
const zipCache = new Map<string, Zip>();
const ZIP_CACHE_MAX = 8;

function loadZip(key: string, getBytes: () => Uint8Array): Zip {
  const hit = zipCache.get(key);
  if (hit) {
    zipCache.delete(key);
    zipCache.set(key, hit);
    return hit;
  }
  const buf = getBytes();
  const names = readZipNames(buf);
  const order: string[] = [];
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(buf, {
      filter: (f) => {
        order.push(f.name);
        return true;
      },
    });
  } catch (e) {
    throw new HttpError(422, `Cannot read zip archive: ${(e as Error).message}`);
  }
  const useNames = names && names.length === order.length;
  const entries = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  order.forEach((orig, i) => {
    const name = (useNames ? names![i] : orig).replaceAll("\\", "/").replace(/^\/+/, "");
    const parts = name.split("/").filter(Boolean);
    if (parts.includes("..")) return;
    for (let j = 1; j < parts.length; j++) dirs.add(parts.slice(0, j).join("/"));
    if (name.endsWith("/")) dirs.add(parts.join("/"));
    else if (raw[orig]) entries.set(parts.join("/"), raw[orig]);
  });
  const zip = { entries, dirs };
  zipCache.set(key, zip);
  if (zipCache.size > ZIP_CACHE_MAX) zipCache.delete(zipCache.keys().next().value!);
  return zip;
}

const isZipName = (n: string) => /\.zip$/i.test(n);

export type Resolved =
  | { kind: "dir"; real: string }
  | { kind: "file"; real: string; size: number; mtime: number; key: string }
  | { kind: "mem"; data: Uint8Array; key: string }
  | { kind: "zipdir"; zip: Zip; prefix: string };

function splitPath(vpath: string): string[] {
  const segs = vpath.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segs.some((s) => s === ".." || s === "." || s.includes("\0"))) throw new HttpError(400, "Invalid path");
  return segs;
}

function resolveInZip(zip: Zip, key: string, rest: string[]): Resolved {
  for (let j = 1; j <= rest.length; j++) {
    const name = rest.slice(0, j).join("/");
    const data = zip.entries.get(name);
    if (!data) continue;
    const k = `${key}/${name}`;
    if (j === rest.length) return { kind: "mem", data, key: k };
    if (!isZipName(name)) break;
    return resolveInZip(loadZip(k, () => data), k, rest.slice(j));
  }
  const prefix = rest.join("/");
  if (zip.dirs.has(prefix)) return { kind: "zipdir", zip, prefix };
  throw new HttpError(404, "Not found in archive");
}

export async function resolveV(root: string, vpath: string): Promise<Resolved> {
  const segs = splitPath(vpath);
  const rootAbs = resolve(root);
  let real = rootAbs;
  for (let i = 0; i < segs.length; i++) {
    const next = join(real, segs[i]);
    if (!next.startsWith(rootAbs + sep)) throw new HttpError(400, "Invalid path");
    const st = await stat(next).catch(() => null);
    if (!st) throw new HttpError(404, "Not found");
    if (st.isDirectory()) {
      real = next;
      continue;
    }
    const key = `${next}@${st.mtimeMs}`;
    if (i === segs.length - 1) return { kind: "file", real: next, size: st.size, mtime: st.mtimeMs, key };
    if (!isZipName(segs[i])) throw new HttpError(404, "Not found");
    const bytes = new Uint8Array(await Bun.file(next).arrayBuffer());
    return resolveInZip(loadZip(key, () => bytes), key, segs.slice(i + 1));
  }
  return { kind: "dir", real };
}

export async function readBytes(r: Resolved): Promise<Uint8Array> {
  if (r.kind === "mem") return r.data;
  if (r.kind === "file") return new Uint8Array(await Bun.file(r.real).arrayBuffer());
  throw new HttpError(400, "Not a file");
}

const sortNodes = (a: TreeNode, b: TreeNode) =>
  a.type === b.type ? a.name.localeCompare(b.name, "de", { numeric: true }) : a.type === "dir" ? -1 : 1;

function zipTree(zip: Zip, base: string): TreeNode[] {
  const rootNodes: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();
  const ensureDir = (p: string): TreeNode[] => {
    if (!p) return rootNodes;
    let d = dirMap.get(p);
    if (!d) {
      const i = p.lastIndexOf("/");
      d = { name: p.slice(i + 1), path: `${base}/${p}`, type: "dir", children: [] };
      dirMap.set(p, d);
      ensureDir(i < 0 ? "" : p.slice(0, i)).push(d);
    }
    return d.children!;
  };
  for (const d of zip.dirs) ensureDir(d);
  for (const [name, data] of zip.entries) {
    const i = name.lastIndexOf("/");
    const node: TreeNode = { name: name.slice(i + 1), path: `${base}/${name}`, type: "file", size: data.length };
    if (isZipName(name)) node.zip = true;
    ensureDir(i < 0 ? "" : name.slice(0, i)).push(node);
  }
  const sortRec = (ns: TreeNode[]) => {
    ns.sort(sortNodes);
    for (const n of ns) if (n.children) sortRec(n.children);
  };
  sortRec(rootNodes);
  return rootNodes;
}

// Archive listings are small, so they are kept for the lifetime of the server.
const listCache = new Map<string, TreeNode[]>();

/** Full listing of an archive, including archives nested inside it. */
function zipTreeDeep(zip: Zip, key: string, base: string): TreeNode[] {
  const ck = `${key}|${base}`;
  const hit = listCache.get(ck);
  if (hit) return hit;
  const nodes = zipTree(zip, base);
  const fill = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.zip) {
        const inner = n.path.slice(base.length + 1);
        const data = zip.entries.get(inner);
        const k = `${key}/${inner}`;
        try {
          n.children = data ? zipTreeDeep(loadZip(k, () => data), k, n.path) : [];
        } catch {
          n.children = [];
        }
      } else if (n.children) fill(n.children);
    }
  };
  fill(nodes);
  listCache.set(ck, nodes);
  return nodes;
}

async function realZipChildren(full: string, mtime: number, path: string): Promise<TreeNode[]> {
  const key = `${full}@${mtime}`;
  const hit = listCache.get(`${key}|${path}`);
  if (hit) return hit;
  try {
    const bytes = new Uint8Array(await Bun.file(full).arrayBuffer());
    return zipTreeDeep(loadZip(key, () => bytes), key, path);
  } catch {
    return [];
  }
}

async function dirTree(real: string, base: string): Promise<TreeNode[]> {
  const out: TreeNode[] = [];
  for (const e of await readdir(real, { withFileTypes: true })) {
    if (e.name.startsWith("~$") || e.name === "Thumbs.db" || e.name === "desktop.ini") continue;
    const path = base ? `${base}/${e.name}` : e.name;
    const full = join(real, e.name);
    if (e.isDirectory()) out.push({ name: e.name, path, type: "dir", children: await dirTree(full, path) });
    else if (e.isFile()) {
      const st = await stat(full);
      const n: TreeNode = { name: e.name, path, type: "file", size: st.size, mtime: st.mtimeMs };
      if (isZipName(e.name)) {
        n.zip = true;
        n.children = await realZipChildren(full, st.mtimeMs, path);
      }
      out.push(n);
    }
  }
  return out.sort(sortNodes);
}

/** Children of a folder (recursive) or of a zip archive (recursive, nested zips stay lazy). */
export async function listTree(root: string, vpath: string): Promise<TreeNode[]> {
  const base = splitPath(vpath).join("/");
  const r = await resolveV(root, vpath);
  if (r.kind === "dir") return dirTree(r.real, base);
  if (r.kind === "zipdir") throw new HttpError(400, "List the archive itself");
  if (!isZipName(base)) throw new HttpError(400, "Not a folder or archive");
  const bytes = r.kind === "mem" ? r.data : await readBytes(r);
  return zipTreeDeep(loadZip(r.key, () => bytes), r.key, base);
}

export function treeStats(nodes: TreeNode[]): { files: number; size: number } {
  let files = 0;
  let size = 0;
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.type === "file") {
        size += n.size ?? 0;
        if (n.zip && n.children) countInner(n.children);
        else files++;
      } else if (n.children) walk(n.children);
    }
  };
  // Files inside an archive count as documents; their size is already in the archive.
  const countInner = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.children) countInner(n.children);
      else files++;
    }
  };
  walk(nodes);
  return { files, size };
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  xml: "text/xml",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

export function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}
