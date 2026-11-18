// Column definitions and rows for the three table levels:
// provider -> projects, project -> documents, document -> annotations.
import { extOf, flatFiles, folderOf, type Annotation, type Provider, type ProjectSummary, type TreeNode, type ViewConfig } from "./api";
import { t } from "./i18n.svelte";
import { qia } from "./qia.svelte";
import { app } from "./state.svelte";
import type { Column } from "./table";

type Builtin = { name: string; config: Partial<ViewConfig> };

const customOf = (list: { key: string; value: string }[] | undefined, key: string) => list?.find((f) => f.key.trim() === key)?.value ?? "";
const customKeys = (lists: ({ key: string; value: string }[] | undefined)[]) => [...new Set(lists.flatMap((l) => (l ?? []).map((f) => f.key.trim())).filter(Boolean))].sort();

// ---------- projects ----------

export type ProjectRow = ProjectSummary & { provider: string; annos: number; codings: number; coded: string };

export function projectRows(p: Provider): ProjectRow[] {
  const counts = new Map<string, number>();
  for (const a of app.annotations) if (a.provider === p.id) counts.set(a.project, (counts.get(a.project) ?? 0) + 1);
  const id = qia.activeId;
  const codings = new Map<string, number>();
  for (const a of app.annotations) if (id && a.provider === p.id && a.analysis === id && a.category) codings.set(a.project, (codings.get(a.project) ?? 0) + 1);
  const mat = qia.material.filter((m) => m.analysis === id && m.provider === p.id);
  return p.projects.map((pr) => {
    const own = mat.filter((m) => m.file.startsWith(pr.folder + "/"));
    return {
      ...pr,
      provider: p.id,
      annos: counts.get(pr.folder) ?? 0,
      codings: codings.get(pr.folder) ?? 0,
      coded: own.length ? `${own.filter((m) => m.state === "coded").length} / ${own.length}` : "",
    };
  });
}

export function projectColumns(p: Provider): Column<ProjectRow>[] {
  const reg = [...new Set(p.projects.flatMap((pr) => Object.keys(pr.register ?? {})))];
  return [
    { id: "number", label: t("Number"), get: (r) => r.details.number, cell: "plate", width: "120px" },
    { id: "title", label: t("Title"), get: (r) => r.details.title, width: "minmax(240px, 3fr)" },
    { id: "status", label: t("Status"), get: (r) => r.details.status, cell: "status", width: "130px" },
    { id: "branch", label: t("Branch"), get: (r) => r.details.branch, width: "minmax(110px, 1fr)", empty: t("No branch") },
    { id: "road", label: t("Road"), get: (r) => r.details.road, width: "80px", empty: t("No road") },
    { id: "contract", label: t("Contract number"), get: (r) => r.details.contract, width: "minmax(130px, 1fr)", hidden: true },
    { id: "phases", label: t("Service phases"), get: (r) => r.details.phases, hidden: true },
    { id: "summary", label: t("Summary"), get: (r) => r.details.summary, width: "minmax(200px, 2fr)", hidden: true },
    { id: "notes", label: t("Notes"), get: (r) => r.details.notes, width: "minmax(200px, 2fr)", hidden: true },
    ...customKeys(p.projects.map((pr) => pr.details.custom)).map(
      (key): Column<ProjectRow> => ({ id: `custom:${key}`, label: key, get: (r) => customOf(r.details.custom, key) }),
    ),
    ...reg.map((key): Column<ProjectRow> => ({ id: `list:${key}`, label: t("List: {key}", { key }), get: (r) => r.register?.[key] ?? "", hidden: true })),
    { id: "files", label: t("Documents"), get: (r) => r.files, type: "number", width: "90px" },
    { id: "size", label: t("Size"), get: (r) => r.size, type: "size", width: "80px" },
    { id: "annos", label: t("Annotations"), get: (r) => r.annos, cell: "count", width: "100px" },
    ...(qia.active
      ? ([
          { id: "codings", label: t("Coded segments"), get: (r) => r.codings, cell: "count", width: "120px" },
          { id: "coded", label: t("Documents coded"), get: (r) => r.coded, width: "130px" },
        ] satisfies Column<ProjectRow>[])
      : []),
  ];
}

export const projectViews = (): Builtin[] => [
  { name: t("All projects"), config: { sort: [{ id: "number", dir: 1 }] } },
  { name: t("By branch"), config: { groups: ["branch"], sort: [{ id: "number", dir: 1 }] } },
  { name: t("By status"), config: { groups: ["status"], sort: [{ id: "number", dir: 1 }] } },
];

// ---------- documents ----------

export type DocRow = { provider: string; path: string; name: string; folder: string; ext: string; size: number; mtime: number; tags: string[]; annos: number; codings: number; material: string };

export function documentRows(provider: string, nodes: TreeNode[], project: string): DocRow[] {
  const counts = new Map<string, number>();
  for (const a of app.annotations) if (a.provider === provider) counts.set(a.file, (counts.get(a.file) ?? 0) + 1);
  const id = qia.activeId;
  const codings = new Map<string, number>();
  for (const a of app.annotations) if (id && a.provider === provider && a.analysis === id && a.category) codings.set(a.file, (codings.get(a.file) ?? 0) + 1);
  return flatFiles(nodes).map((f) => ({
    provider,
    path: f.path,
    name: f.name,
    folder: folderOf(f.path, project),
    ext: extOf(f.name) || "–",
    size: f.size ?? 0,
    mtime: f.mtime ?? 0,
    tags: app.tagsOf(provider, f.path),
    annos: counts.get(f.path) ?? 0,
    codings: codings.get(f.path) ?? 0,
    material: id ? qia.materialState(id, provider, f.path) : "",
  }));
}

export function documentColumns(rows: DocRow[]): Column<DocRow>[] {
  const extra = (r: DocRow) => app.docExtra(r.provider, r.path);
  return [
    { id: "name", label: t("Name"), get: (r) => r.name, cell: "file", width: "minmax(260px, 3fr)" },
    { id: "folder", label: t("Folder"), get: (r) => r.folder, width: "minmax(140px, 2fr)", empty: t("Project folder (top level)") },
    { id: "ext", label: t("Format"), get: (r) => r.ext, width: "70px" },
    { id: "tags", label: t("Tags"), get: (r) => r.tags, type: "tags", width: "minmax(120px, 1.5fr)", empty: t("No tags") },
    { id: "description", label: t("Description"), get: (r) => extra(r).description ?? "", width: "minmax(180px, 2fr)", hidden: true },
    { id: "notes", label: t("Notes"), get: (r) => extra(r).notes ?? "", width: "minmax(180px, 2fr)", hidden: true },
    ...customKeys(rows.map((r) => extra(r).custom)).map(
      (key): Column<DocRow> => ({ id: `custom:${key}`, label: key, get: (r) => customOf(extra(r).custom, key) }),
    ),
    { id: "annos", label: t("Annotations"), get: (r) => r.annos, cell: "count", width: "100px" },
    ...(qia.active
      ? ([
          { id: "material", label: t("Material"), get: (r) => (r.material === "coded" ? t("Coded") : r.material ? t("To be coded") : ""), width: "110px", empty: t("Not in the material") },
          { id: "codings", label: t("Coded segments"), get: (r) => r.codings, cell: "count", width: "120px" },
        ] satisfies Column<DocRow>[])
      : []),
    { id: "origin", label: t("Origin"), get: (r) => extra(r).origin ?? "", width: "minmax(160px, 2fr)", hidden: true },
    { id: "formal", label: t("Formal characteristics"), get: (r) => extra(r).formal ?? "", width: "minmax(160px, 2fr)", hidden: true },
    { id: "size", label: t("Size"), get: (r) => r.size, type: "size", width: "80px" },
    { id: "mtime", label: t("Modified"), get: (r) => r.mtime || null, type: "date", width: "100px", hidden: true },
  ];
}

export const documentViews = (): Builtin[] => [
  { name: t("All documents"), config: { sort: [{ id: "folder", dir: 1 }, { id: "name", dir: 1 }] } },
  { name: t("By folder"), config: { groups: ["folder"], hidden: ["folder"], sort: [{ id: "name", dir: 1 }] } },
  { name: t("By format"), config: { groups: ["ext"], hidden: ["ext"], sort: [{ id: "name", dir: 1 }] } },
  { name: t("By tag"), config: { groups: ["tags"], sort: [{ id: "name", dir: 1 }] } },
];

// ---------- annotations ----------

const KIND: Record<Annotation["kind"], string> = { highlight: "Highlight", area: "Area", note: "Note", cell: "Cell", doc: "Note" };

export function annotationColumns(withDocument: boolean): Column<Annotation>[] {
  return [
    ...(withDocument
      ? [{ id: "file", label: t("Document"), get: (a: Annotation) => a.file.split("/").pop() ?? a.file, cell: "file", width: "minmax(200px, 2fr)" } satisfies Column<Annotation>]
      : []),
    {
      id: "where",
      label: t("Location"),
      get: (a) => (a.kind === "cell" ? `${a.anchor?.sheet} ${a.anchor?.ref}` : a.page ? t("Page {n}", { n: a.page }) : t("Whole document")),
      width: "120px",
    },
    { id: "kind", label: t("Type"), get: (a) => t(KIND[a.kind]), width: "100px" },
    ...(qia.analyses.length
      ? [{ id: "category", label: t("Category"), get: (a: Annotation) => qia.label(a.category), width: "minmax(140px, 1.5fr)", empty: t("No category") } satisfies Column<Annotation>]
      : []),
    { id: "quote", label: t("Marked text"), get: (a) => a.quote, width: "minmax(200px, 3fr)" },
    { id: "comment", label: t("Comment"), get: (a) => a.comment, width: "minmax(180px, 2fr)" },
    { id: "tags", label: t("Tags"), get: (a) => a.tags, type: "tags", width: "minmax(110px, 1fr)", empty: t("No tags") },
    { id: "color", label: t("Colour"), get: (a) => a.color, cell: "color", width: "90px" },
    { id: "created", label: t("Created"), get: (a) => a.created, type: "date", width: "100px", hidden: true },
  ];
}

// ---------- coded segments of one analysis ----------

const whereOf = (a: Annotation) => (a.kind === "cell" ? `${a.anchor?.sheet} ${a.anchor?.ref}` : a.page ? t("Page {n}", { n: a.page }) : t("Whole document"));

export function segmentColumns(summarizing: boolean): Column<Annotation>[] {
  return [
    { id: "main", label: t("Main category"), get: (a) => qia.main(a.category)?.name ?? "", width: "minmax(130px, 1.2fr)" },
    { id: "category", label: t("Category"), get: (a) => qia.category(a.category)?.name ?? "", width: "minmax(130px, 1.2fr)" },
    { id: "project", label: t("Project"), get: (a) => app.project(a.provider, a.project)?.number || a.project, cell: "plate", width: "120px", empty: t("Provider files") },
    { id: "file", label: t("Document"), get: (a) => a.file.split("/").pop() ?? a.file, cell: "file", width: "minmax(180px, 2fr)" },
    { id: "where", label: t("Location"), get: whereOf, width: "100px" },
    { id: "quote", label: t("Marked text"), get: (a) => a.quote, width: "minmax(220px, 3fr)" },
    { id: "paraphrase", label: t("Paraphrase"), get: (a) => a.paraphrase, width: "minmax(180px, 2fr)", hidden: !summarizing },
    { id: "generalization", label: t("Generalization"), get: (a) => a.generalization, width: "minmax(180px, 2fr)", hidden: !summarizing },
    { id: "reduction", label: t("Reduction"), get: (a) => a.reduction, width: "minmax(180px, 2fr)", hidden: !summarizing },
    { id: "comment", label: t("Comment"), get: (a) => a.comment, width: "minmax(160px, 2fr)" },
  ];
}

export const segmentViews = (): Builtin[] => [
  { name: t("By category"), config: { groups: ["main", "category"], hidden: ["main", "category"] } },
  { name: t("All segments"), config: { sort: [{ id: "main", dir: 1 }, { id: "category", dir: 1 }] } },
  { name: t("By project"), config: { groups: ["project", "main"], hidden: ["project", "main"] } },
  { name: t("By document"), config: { groups: ["file"], hidden: ["file"] } },
];

export const annotationViews = (withDocument: boolean): Builtin[] => [
  { name: t("All annotations"), config: {} },
  ...(withDocument ? [{ name: t("By document"), config: { groups: ["file"], hidden: ["file"] } }] : []),
  { name: t("By tag"), config: { groups: ["tags"] } },
  { name: t("By colour"), config: { groups: ["color"] } },
];
