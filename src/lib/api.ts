import { i18n } from "./i18n.svelte";

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
  zip?: boolean;
  children?: TreeNode[];
};

export type ProjectSummary = {
  folder: string;
  number: string;
  title: string;
  status: string;
  files: number;
  size: number;
  details: ProjectDetails; // saved details, filled up from the provider's project list
  register: Record<string, string> | null;
};

/** Free-form details of a provider or a document. */
export type Extra = { description?: string; origin?: string; formal?: string; notes?: string; custom?: { key: string; value: string }[] };

/** One saved combination of columns, filters, grouping and sorting for a table. */
export type ViewConfig = {
  hidden: string[]; // columns switched off
  shown: string[]; // columns switched on that are off by default
  filters: Record<string, string>;
  sort: { id: string; dir: 1 | -1 }[];
  groups: string[];
  showFilters: boolean;
};
export type SavedView = { id: string; kind: string; name: string; config: ViewConfig };

export type Provider = {
  id: string;
  name: string;
  root: string;
  error?: string;
  projects: ProjectSummary[];
  files: TreeNode[];
};

export type ProjectDetails = {
  number: string;
  title: string;
  branch: string;
  contract: string;
  road: string;
  phases: string;
  status: string;
  summary: string;
  notes: string;
  custom: { key: string; value: string }[];
};

export type ProjectInfo = {
  folder: string;
  parsed: { number: string; title: string };
  register: Record<string, string> | null;
  details: Partial<ProjectDetails> | null;
  updated: number | null;
};

/** The signed-in person. Locally there is one user with all rights. */
export type Me = { id: string; email: string; name: string; role: "admin" | "editor" | "viewer"; local: boolean; logoutUrl: string };

export type Rect = { x: number; y: number; w: number; h: number };

export type Annotation = {
  id: string;
  provider: string;
  project: string;
  file: string;
  kind: "highlight" | "area" | "note" | "cell" | "doc";
  page: number | null;
  anchor: { rects?: Rect[]; sheet?: string; ref?: string; r?: number; c?: number } | null;
  quote: string;
  comment: string;
  color: string;
  tags: string[];
  // content analysis: the study and category this passage is coded with, and the summarizing steps
  author: string; // who marked it (empty for local use)
  analysis: string;
  category: string;
  paraphrase: string;
  generalization: string;
  reduction: string;
  created: number;
  updated: number;
};

export type Sheet = {
  name: string;
  rows: number;
  cols: number;
  cells: string[][];
  merges: { r: number; c: number; rs: number; cs: number }[];
  colWidths: number[];
  rowHeights: number[];
  styles: string[];
  styleIdx: number[][];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401 && !sessionStorage.getItem("analyzer.relogin")) {
    sessionStorage.setItem("analyzer.relogin", "1");
    location.reload();
  }
  if (res.ok) sessionStorage.removeItem("analyzer.relogin");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fileUrl = (provider: string, path: string, download = false) =>
  `/api/file?${qs({ provider, path })}${download ? "&download=1" : ""}`;

export const api = {
  me: () => request<Me>("/api/me"),
  providers: () => request<Provider[]>("/api/providers"),
  addProvider: (name: string, root: string) => request<{ id: string }>("/api/providers", send("POST", { name, root })),
  tree: (provider: string, path: string) => request<TreeNode[]>(`/api/tree?${qs({ provider, path })}`),
  sheet: (provider: string, path: string) => request<Sheet[]>(`/api/sheet?${qs({ provider, path })}`),
  project: (provider: string, folder: string) => request<ProjectInfo>(`/api/project?${qs({ provider, folder })}`),
  saveProject: (provider: string, folder: string, details: ProjectDetails) =>
    request<{ updated: number }>(`/api/project?${qs({ provider, folder })}`, send("PUT", details)),
  annotations: () => request<Annotation[]>("/api/annotations"),
  addAnnotation: (a: Partial<Annotation>) => request<Annotation>("/api/annotations", send("POST", a)),
  updateAnnotation: (id: string, patch: Partial<Annotation>) => request<Annotation>(`/api/annotations/${id}`, send("PUT", patch)),
  deleteAnnotation: (id: string) => request<{ ok: boolean }>(`/api/annotations/${id}`, { method: "DELETE" }),
  open: (provider: string, path: string, reveal = false) => request<{ ok: boolean }>("/api/open", send("POST", { provider, path, reveal })),
  details: () => request<{ kind: "provider" | "document"; provider: string; path: string; data: Extra }[]>("/api/details"),
  setDetails: (kind: "provider" | "document", provider: string, path: string, data: Extra) =>
    request<{ ok: boolean }>("/api/details", send("PUT", { kind, provider, path, data })),
  views: () => request<SavedView[]>("/api/views"),
  saveView: (view: { id?: string; kind: string; name: string; config: ViewConfig }) => request<SavedView>("/api/views", send("PUT", view)),
  deleteView: (id: string) => request<{ ok: boolean }>(`/api/views/${id}`, { method: "DELETE" }),
  fileTags: () => request<{ provider: string; file: string; tags: string[] }[]>("/api/filetags"),
  setFileTags: (provider: string, file: string, tags: string[]) => request<{ tags: string[] }>("/api/filetags", send("PUT", { provider, file, tags })),
  exportUrl: (provider: string, project: string) => `/api/export?${qs({ provider, project })}`,
};

export function formatSize(n = 0): string {
  const num = (v: number, digits: number) => v.toLocaleString(i18n.lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${num(n / 1024, 0)} KB`;
  if (n < 1024 ** 3) return `${num(n / 1024 ** 2, 1)} MB`;
  return `${num(n / 1024 ** 3, 2)} GB`;
}

export const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

export type FileKind = "pdf" | "sheet" | "docx" | "image" | "text" | "other";
export function kindOf(name: string): FileKind {
  const e = extOf(name);
  if (e === "pdf") return "pdf";
  if (["xlsx", "xlsm", "xls", "csv", "ods"].includes(e)) return "sheet";
  if (e === "docx") return "docx";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(e)) return "image";
  if (["xml", "txt", "json", "md", "log", "ini", "x81", "x83", "x84", "x86", "d83", "p83", "ifc"].includes(e)) return "text";
  return "other";
}

export function flatFiles(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  // Archives are treated as folders: their contents are listed, not the archive itself.
  for (const n of nodes) {
    if (n.children) flatFiles(n.children, out);
    else if (n.type === "file") out.push(n);
  }
  return out;
}

export const STATUSES = ["Not started", "In review", "Analysed", "On hold"];
export const STATUS_COLOR: Record<string, string> = {
  "In review": "#f5c400",
  Analysed: "#3fae5a",
  "On hold": "#f08a24",
};

/** Folder part of a virtual path, without the project folder. */
export function folderOf(path: string, project = ""): string {
  const dir = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  return project && dir.startsWith(project) ? dir.slice(project.length + 1) : dir;
}

export const COLORS: Record<string, string> = {
  yellow: "#f5c400",
  green: "#3fae5a",
  blue: "#3b8ee6",
  pink: "#e8559a",
  orange: "#f08a24",
};
