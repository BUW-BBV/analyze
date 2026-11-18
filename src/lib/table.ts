// Logic of the reusable data table: filtering, sorting, nested grouping, CSV export.
// The same table shows projects (provider level), documents (project level) and
// annotations (document level); only the column definitions differ.
import { formatSize, type ViewConfig } from "./api";
import { i18n, t } from "./i18n.svelte";

export type Value = string | number | string[] | null | undefined;

export type Column<R = any> = {
  id: string;
  label: string;
  get: (row: R) => Value;
  type?: "text" | "number" | "size" | "date" | "tags";
  cell?: "file" | "plate" | "status" | "count" | "color";
  width?: string; // grid track, e.g. "minmax(220px, 2fr)"
  hidden?: boolean; // switched off unless a view turns it on
  empty?: string; // group heading for rows without a value
};

export type Item<R> =
  | { type: "group"; key: string; depth: number; column: string; label: string; count: number; open: boolean }
  | { type: "row"; key: string; depth: number; row: R };

export const emptyView = (): ViewConfig => ({ hidden: [], shown: [], filters: {}, sort: [], groups: [], showFilters: false });
export const withDefaults = (c: Partial<ViewConfig> | undefined): ViewConfig => ({ ...emptyView(), ...JSON.parse(JSON.stringify(c ?? {})) });

export const isVisible = (col: Column, c: ViewConfig) => c.shown.includes(col.id) || (!col.hidden && !c.hidden.includes(col.id));

/** The value as shown in a cell, a filter match or a CSV file. */
export function display(col: Column, row: unknown): string {
  const v = col.get(row);
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  if (col.type === "size") return formatSize(Number(v));
  if (col.type === "date") return new Date(Number(v)).toLocaleDateString(i18n.lang, { year: "numeric", month: "2-digit", day: "2-digit" });
  if (col.cell === "status") return t(String(v));
  return String(v);
}

/** Text filters match every word; number columns also accept >, <, >=, <= and =. Sizes are compared in MB. */
function matches(col: Column, row: unknown, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const numeric = col.type === "number" || col.type === "size" || col.cell === "count";
  const op = numeric ? q.match(/^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/) : null;
  if (op) {
    const raw = Number(col.get(row) ?? 0) / (col.type === "size" ? 1024 * 1024 : 1);
    const n = Number(op[2].replace(",", "."));
    return op[1] === ">" ? raw > n : op[1] === "<" ? raw < n : op[1] === ">=" ? raw >= n : op[1] === "<=" ? raw <= n : raw === n;
  }
  const text = display(col, row).toLowerCase();
  return q.split(/\s+/).every((term) => text.includes(term));
}

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

function compare(col: Column, a: unknown, b: unknown): number {
  const x = col.get(a);
  const y = col.get(b);
  if (typeof x === "number" || typeof y === "number") return Number(x ?? 0) - Number(y ?? 0);
  return collator.compare(Array.isArray(x) ? x.join(", ") : String(x ?? ""), Array.isArray(y) ? y.join(", ") : String(y ?? ""));
}

export function filterAndSort<R>(rows: R[], columns: Column<R>[], c: ViewConfig): R[] {
  const byId = new Map(columns.map((col) => [col.id, col]));
  const active = Object.entries(c.filters).filter(([id, q]) => q.trim() && byId.has(id));
  const out = active.length ? rows.filter((r) => active.every(([id, q]) => matches(byId.get(id)!, r, q))) : [...rows];
  const sorts = c.sort.filter((s) => byId.has(s.id));
  if (sorts.length) {
    out.sort((a, b) => {
      for (const s of sorts) {
        const d = compare(byId.get(s.id)!, a, b) * s.dir;
        if (d) return d;
      }
      return 0;
    });
  }
  return out;
}

/** Turn the rows into the list that is rendered: group headings (nested) and rows. */
export function layout<R>(rows: R[], columns: Column<R>[], c: ViewConfig, rowKey: (r: R) => string, collapsed: Set<string>): Item<R>[] {
  const byId = new Map(columns.map((col) => [col.id, col]));
  const groups = c.groups.filter((id) => byId.has(id));
  const out: Item<R>[] = [];
  const walk = (list: R[], depth: number, prefix: string) => {
    if (depth >= groups.length) {
      for (const row of list) out.push({ type: "row", key: `${prefix}/${rowKey(row)}`, depth, row });
      return;
    }
    const col = byId.get(groups[depth])!;
    const buckets = new Map<string, R[]>();
    for (const row of list) {
      const v = col.get(row);
      // a row with several tags appears under each of them
      const keys = Array.isArray(v) ? (v.length ? v : [""]) : [display(col, row)];
      for (const k of keys) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(row);
    }
    const names = [...buckets.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : collator.compare(a, b)));
    for (const name of names) {
      const key = `${prefix}/${col.id}=${name}`;
      const open = !collapsed.has(key);
      out.push({ type: "group", key, depth, column: col.label, label: name || col.empty || t("(empty)"), count: buckets.get(name)!.length, open });
      if (open) walk(buckets.get(name)!, depth + 1, key);
    }
  };
  walk(rows, 0, "");
  return out;
}

export function toCsv<R>(rows: R[], columns: Column<R>[]): string {
  const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const lines = [columns.map((c) => cell(c.label)).join(";"), ...rows.map((r) => columns.map((c) => cell(display(c, r))).join(";"))];
  return "﻿" + lines.join("\r\n");
}
