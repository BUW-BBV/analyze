import { api, type Annotation, type Me, type Extra, type ProjectDetails, type Provider, type SavedView, type TreeNode, type ViewConfig } from "./api";
import { qia } from "./qia.svelte";
import { tabId, ws, type Tab } from "./workspace.svelte";

export type MenuItem = { label: string; action: () => void; danger?: boolean; separator?: boolean };

class AppState {
  me = $state.raw<Me | null>(null);
  providers = $state.raw<Provider[]>([]);
  trees = $state.raw<Record<string, TreeNode[]>>({}); // whole file tree per provider, archives included
  loading = $state(true);
  error = $state("");
  annotations = $state<Annotation[]>([]);
  focusedAnno = $state<string | null>(null);
  expanded = $state<Record<string, boolean>>({}); // file tree nodes, by path
  openProjects = $state<Record<string, boolean>>({}); // projects whose files are shown in the sidebar
  paletteOpen = $state(false);
  fileTags = $state<Record<string, string[]>>({}); // key: provider|path
  docDetails = $state<Record<string, Extra>>({}); // key: provider|path
  providerDetails = $state<Record<string, Extra>>({}); // key: provider id
  views = $state<SavedView[]>([]);
  tagTarget = $state.raw<{ provider: string; path: string } | null>(null); // file whose tags are being edited
  sidebarPinned = $state(localStorage.getItem("analyzer.sidebar.pinned") !== "no");
  panelOpen = $state(localStorage.getItem("analyzer.panel") !== "closed");
  panelTab = $state<"details" | "annotations">("details");
  panelWidth = $state(Number(localStorage.getItem("analyzer.panel.width")) || 320);
  // "" = Details and Annotations as tabs; otherwise both are shown and this one is on top
  panelSplit = $state<"" | "details" | "annotations">((localStorage.getItem("analyzer.panel.split") as "" | "details" | "annotations" | null) ?? "");
  panelRatio = $state(Number(localStorage.getItem("analyzer.panel.ratio")) || 0.45);
  menu = $state.raw<{ x: number; y: number; items: MenuItem[] } | null>(null);
  theme = $state<"light" | "dark">(
    (localStorage.getItem("analyzer.theme") as "light" | "dark" | null) ??
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );

  constructor() {
    document.documentElement.dataset.theme = this.theme;
  }

  /** True on your own computer: files can be opened in other programs and providers added by folder. */
  get local(): boolean {
    return this.me?.local ?? false;
  }

  get canEdit(): boolean {
    return this.me?.role !== "viewer";
  }

  /** The provider or project whose tabs are showing. */
  get selected(): { provider: string; folder: string } | null {
    if (!ws.scope) return null;
    const i = ws.scope.indexOf("|");
    return i < 0 ? { provider: ws.scope, folder: "" } : { provider: ws.scope.slice(0, i), folder: ws.scope.slice(i + 1) };
  }

  toggleTheme() {
    this.theme = this.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = this.theme;
    localStorage.setItem("analyzer.theme", this.theme);
  }

  toggleSidebar() {
    this.sidebarPinned = !this.sidebarPinned;
    localStorage.setItem("analyzer.sidebar.pinned", this.sidebarPinned ? "yes" : "no");
  }

  setPanelSplit(top: "" | "details" | "annotations") {
    this.panelSplit = top;
    localStorage.setItem("analyzer.panel.split", top);
  }

  savePanelSize() {
    localStorage.setItem("analyzer.panel.width", String(Math.round(this.panelWidth)));
    localStorage.setItem("analyzer.panel.ratio", String(this.panelRatio));
  }

  togglePanel(open = !this.panelOpen) {
    this.panelOpen = open;
    localStorage.setItem("analyzer.panel", open ? "open" : "closed");
  }

  async load() {
    this.loading = true;
    try {
      // an older server without sign-in support counts as local use
      this.me = await api.me().catch(() => ({ id: "local", email: "", name: "", role: "admin" as const, local: true, logoutUrl: "" }));
      const [providers, annotations, tags, details, views] = await Promise.all([
        api.providers(),
        api.annotations(),
        api.fileTags(),
        api.details(),
        api.views(),
        qia.load(),
      ]);
      this.providers = providers;
      this.annotations = annotations;
      this.fileTags = Object.fromEntries(tags.map((t) => [`${t.provider}|${t.file}`, t.tags]));
      this.docDetails = Object.fromEntries(details.filter((d) => d.kind === "document").map((d) => [`${d.provider}|${d.path}`, d.data]));
      this.providerDetails = Object.fromEntries(details.filter((d) => d.kind === "provider").map((d) => [d.provider, d.data]));
      this.views = views;
      this.error = "";
      const trees: Record<string, TreeNode[]> = {};
      await Promise.all(
        providers.filter((p) => !p.error).map(async (p) => (trees[p.id] = await api.tree(p.id, "").catch(() => []))),
      );
      this.trees = trees;
      // Land somewhere useful: the last scope if it still exists, else the first provider.
      const sel = this.selected;
      const prov = providers.find((p) => p.id === sel?.provider);
      if (!prov || (sel?.folder && !prov.projects.some((p) => p.folder === sel.folder))) {
        if (providers[0]) this.openProvider(providers[0].id);
      } else if (sel?.folder) this.openProjects = { [`${sel.provider}|${sel.folder}`]: true };
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async refreshProviders() {
    this.providers = await api.providers();
  }

  provider(id: string) {
    return this.providers.find((p) => p.id === id);
  }

  project(provider: string, folder: string) {
    return this.provider(provider)?.projects.find((p) => p.folder === folder);
  }

  projectTree(provider: string, folder: string): TreeNode[] | undefined {
    const top = this.trees[provider];
    return top ? (top.find((n) => n.type === "dir" && n.name === folder)?.children ?? []) : undefined;
  }

  // ---------- scopes and tabs ----------

  private overviewTab(provider: string, folder: string): Tab {
    if (!folder) {
      return { id: tabId("provider", provider, ""), kind: "provider", provider, project: "", path: "", title: this.provider(provider)?.name ?? provider };
    }
    return { id: tabId("project", provider, folder), kind: "project", provider, project: folder, path: folder, title: this.project(provider, folder)?.number || folder };
  }

  /** Switch to a provider's or project's own set of tabs. Its overview is always there. */
  private enter(provider: string, folder: string, showOverview: boolean) {
    ws.setScope(folder ? `${provider}|${folder}` : provider);
    const overview = this.overviewTab(provider, folder);
    const empty = !Object.keys(ws.tabs).length;
    if (!ws.groupOf(overview.id)) ws.addFirst(overview);
    if (showOverview || empty) ws.open(overview);
    if (folder) this.openProjects = { ...this.openProjects, [`${provider}|${folder}`]: true };
  }

  openProvider(provider: string, showOverview = false) {
    this.enter(provider, "", showOverview);
  }

  openProject(provider: string, folder: string, showOverview = false) {
    this.enter(provider, folder, showOverview);
  }

  /** Show a project's files in the sidebar and collapse the others. */
  revealProject(provider: string, folder: string) {
    this.openProjects = { [`${provider}|${folder}`]: true };
  }

  /** Open a content analysis as a tab in the current provider or project. */
  openAnalysis(id: string) {
    const sel = this.selected;
    const analysis = qia.analyses.find((a) => a.id === id);
    if (!sel || !analysis) return;
    ws.open({ id: tabId("analysis", sel.provider, `${sel.folder}|${id}`), kind: "analysis", provider: sel.provider, project: sel.folder, path: id, title: analysis.name });
  }

  projectOf(provider: string, path: string): string {
    const first = path.split("/")[0];
    return this.provider(provider)?.projects.some((p) => p.folder === first) ? first : "";
  }

  fileTab(provider: string, path: string): Tab {
    return { id: tabId("file", provider, path), kind: "file", provider, project: this.projectOf(provider, path), path, title: path.split("/").pop() ?? path };
  }

  /** A single click opens a preview tab that the next preview replaces; `pin` keeps the tab. */
  openFile(provider: string, path: string, opts: { pin?: boolean; annoId?: string; side?: boolean } = {}) {
    const tab = this.fileTab(provider, path);
    this.enter(provider, tab.project, false);
    tab.preview = !opts.pin && !opts.annoId && !opts.side;
    if (opts.annoId) {
      tab.jump = { annoId: opts.annoId, n: Date.now() };
      this.focusedAnno = opts.annoId;
      this.panelTab = "annotations";
    }
    if (opts.side && !ws.groupOf(tab.id) && ws.activeTab) ws.drop(tab, ws.activeGroup, "right");
    else ws.open(tab);
    if (opts.annoId && ws.tabs[tab.id]?.view?.mode === "overview") ws.tabs[tab.id].view = { ...ws.tabs[tab.id].view, mode: "document" };
  }

  showMenu(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    this.menu = { x: e.clientX, y: e.clientY, items };
  }

  // ---------- details ----------

  async saveProject(provider: string, folder: string, details: ProjectDetails) {
    await api.saveProject(provider, folder, details);
    await this.refreshProviders();
  }

  docExtra(provider: string, path: string): Extra {
    return this.docDetails[`${provider}|${path}`] ?? {};
  }

  async saveDocExtra(provider: string, path: string, data: Extra) {
    this.docDetails[`${provider}|${path}`] = data;
    await api.setDetails("document", provider, path, data);
  }

  async saveProviderExtra(provider: string, data: Extra) {
    this.providerDetails[provider] = data;
    await api.setDetails("provider", provider, "", data);
  }

  // ---------- saved table views ----------

  async saveView(view: { id?: string; kind: string; name: string; config: ViewConfig }): Promise<SavedView> {
    const saved = await api.saveView(view);
    const i = this.views.findIndex((v) => v.id === saved.id);
    if (i >= 0) this.views[i] = saved;
    else this.views.push(saved);
    return saved;
  }

  async deleteView(id: string) {
    this.views = this.views.filter((v) => v.id !== id);
    await api.deleteView(id);
  }

  // ---------- tags ----------

  tagsOf(provider: string, path: string): string[] {
    return this.fileTags[`${provider}|${path}`] ?? [];
  }

  /** Every tag in use, for suggestions. */
  get allTags(): string[] {
    const set = new Set<string>(["AIA", "BAP", "Leistungsbeschreibung", "Leistungsverzeichnis", "Vertrag", "Honorar", "Plan", "Gutachten"]);
    for (const tags of Object.values(this.fileTags)) for (const t of tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }

  async setTags(provider: string, path: string, tags: string[]) {
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    const key = `${provider}|${path}`;
    if (clean.length) this.fileTags[key] = clean;
    else delete this.fileTags[key];
    await api.setFileTags(provider, path, clean);
  }

  // ---------- annotations ----------

  async addAnnotation(a: Partial<Annotation>) {
    const created = await api.addAnnotation(a);
    this.annotations.push(created);
    this.focusedAnno = created.id;
    this.panelTab = "annotations";
    this.togglePanel(true);
    return created;
  }

  async updateAnnotation(id: string, patch: Partial<Annotation>) {
    const i = this.annotations.findIndex((a) => a.id === id);
    if (i < 0) return;
    Object.assign(this.annotations[i], patch);
    await api.updateAnnotation(id, patch);
  }

  async removeAnnotation(id: string) {
    this.annotations = this.annotations.filter((a) => a.id !== id);
    await api.deleteAnnotation(id);
  }
}

export const app = new AppState();
