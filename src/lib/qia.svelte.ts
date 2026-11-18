// Qualitative content analysis after Mayring.
// An analysis (study) holds the question, the technique, the units of analysis and the
// category system. These apply to all material alike, so they are defined once.
// Coding happens in documents: a coded segment is an annotation with a category.
// Projects and providers only aggregate what was coded in their documents.
import { COLORS, type Annotation } from "./api";

export type Technique = "inductive" | "deductive" | "mixed" | "explication";

export type Analysis = {
  id: string;
  name: string;
  question: string; // Fragestellung
  theory: string; // theoriegeleitete Differenzierung
  material: string; // Festlegung des Materials
  origin: string; // Entstehungssituation
  formal: string; // formale Charakteristika
  direction: string; // Richtung der Analyse
  technique: Technique;
  selection: string; // Selektionskriterium (inductive)
  abstraction: string; // Abstraktionsniveau (inductive)
  codingUnit: string; // Kodiereinheit
  contextUnit: string; // Kontexteinheit
  evaluationUnit: string; // Auswertungseinheit
  quality: string; // Gütekriterien
  notes: string; // process log, e.g. revision of the categories after 10-50 % of the material
};

export type Category = {
  id: string;
  analysis: string;
  parent: string; // "" for a main category
  name: string;
  color: string;
  definition: string;
  anchor: string; // Ankerbeispiel
  rule: string; // Kodierregel
  pos: number;
};

export type Material = { analysis: string; provider: string; file: string; state: "included" | "coded" };

const PALETTE = ["#e0a800", "#3fae5a", "#3b8ee6", "#e8559a", "#f08a24", "#8d62c4", "#17a2a2", "#c0504d", "#7a8b2e", "#5c6bc0"];

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
  return res.json();
}

class Qia {
  analyses = $state<Analysis[]>([]);
  categories = $state<Category[]>([]);
  material = $state<Material[]>([]);
  activeId = $state(localStorage.getItem("analyzer.analysis") ?? "");

  /** The analysis new codings go to. */
  get active(): Analysis | undefined {
    return this.analyses.find((a) => a.id === this.activeId);
  }

  setActive(id: string) {
    this.activeId = id;
    localStorage.setItem("analyzer.analysis", id);
  }

  async load() {
    const data = await call<{ analyses: Analysis[]; categories: Category[]; material: Material[] }>("/api/qia");
    this.analyses = data.analyses;
    this.categories = data.categories;
    this.material = data.material;
    if (this.activeId && !this.active) this.setActive("");
  }

  // ---------- analyses ----------

  async createAnalysis(name: string): Promise<Analysis> {
    const blank = {
      name,
      question: "",
      theory: "",
      material: "",
      origin: "",
      formal: "",
      direction: "",
      technique: "deductive" as Technique,
      selection: "",
      abstraction: "",
      codingUnit: "",
      contextUnit: "",
      evaluationUnit: "",
      quality: "",
      notes: "",
    };
    const created = await call<Analysis>("/api/qia/analysis", "PUT", blank);
    this.analyses.push(created);
    this.setActive(created.id);
    return created;
  }

  async saveAnalysis(a: Analysis) {
    const i = this.analyses.findIndex((x) => x.id === a.id);
    if (i >= 0) this.analyses[i] = a;
    await call("/api/qia/analysis", "PUT", a);
  }

  async deleteAnalysis(id: string) {
    this.analyses = this.analyses.filter((a) => a.id !== id);
    this.categories = this.categories.filter((c) => c.analysis !== id);
    this.material = this.material.filter((m) => m.analysis !== id);
    if (this.activeId === id) this.setActive("");
    await call(`/api/qia/analysis/${id}`, "DELETE");
  }

  // ---------- category system ----------

  category(id: string): Category | undefined {
    return id ? this.categories.find((c) => c.id === id) : undefined;
  }

  /** Categories of an analysis in tree order, with their depth. */
  tree(analysis: string): { cat: Category; depth: number }[] {
    const own = this.categories.filter((c) => c.analysis === analysis);
    const out: { cat: Category; depth: number }[] = [];
    const walk = (parent: string, depth: number) => {
      for (const cat of own.filter((c) => (c.parent || "") === parent).sort((a, b) => a.pos - b.pos)) {
        out.push({ cat, depth });
        walk(cat.id, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }

  /** "Main category › Subcategory" */
  label(id: string): string {
    const parts: string[] = [];
    for (let c = this.category(id); c; c = this.category(c.parent)) parts.unshift(c.name);
    return parts.join(" › ");
  }

  main(id: string): Category | undefined {
    let c = this.category(id);
    while (c?.parent && this.category(c.parent)) c = this.category(c.parent);
    return c;
  }

  async addCategory(analysis: string, parent: string, name: string): Promise<Category> {
    const siblings = this.categories.filter((c) => c.analysis === analysis && (c.parent || "") === parent);
    const mains = this.categories.filter((c) => c.analysis === analysis && !c.parent).length;
    const color = parent ? (this.category(parent)?.color ?? PALETTE[0]) : PALETTE[mains % PALETTE.length];
    const pos = Math.max(0, ...siblings.map((c) => c.pos + 1));
    const created = await call<Category>("/api/qia/category", "PUT", { analysis, parent, name, color, definition: "", anchor: "", rule: "", pos });
    this.categories.push(created);
    return created;
  }

  async saveCategory(c: Category) {
    const i = this.categories.findIndex((x) => x.id === c.id);
    if (i >= 0) this.categories[i] = c;
    await call("/api/qia/category", "PUT", c);
  }

  /** Removes a category and its subcategories. Coded passages stay, without category. */
  async deleteCategory(id: string, annotations: Annotation[]) {
    const doomed = new Set<string>([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of this.categories) if (c.parent && doomed.has(c.parent) && !doomed.has(c.id)) grew = !!doomed.add(c.id);
    }
    this.categories = this.categories.filter((c) => !doomed.has(c.id));
    for (const a of annotations) if (doomed.has(a.category)) a.category = "";
    for (const d of doomed) await call(`/api/qia/category/${d}`, "DELETE");
  }

  // ---------- material ----------

  materialState(analysis: string, provider: string, file: string): Material["state"] | "" {
    return this.material.find((m) => m.analysis === analysis && m.provider === provider && m.file === file)?.state ?? "";
  }

  async setMaterial(analysis: string, provider: string, file: string, state: Material["state"] | "") {
    this.material = this.material.filter((m) => !(m.analysis === analysis && m.provider === provider && m.file === file));
    if (state) this.material.push({ analysis, provider, file, state });
    await call("/api/qia/material", "PUT", { analysis, provider, file, state });
  }
}

export const qia = new Qia();

/** Colour of an annotation: its category's colour when it is coded, else the chosen highlight colour. */
export function annoColor(a: Annotation): string {
  return qia.category(a.category)?.color ?? COLORS[a.color] ?? COLORS.yellow;
}
