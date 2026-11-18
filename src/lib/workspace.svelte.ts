// Tabbed workspace model: a tree of splits whose leaves are tab groups.
// Every scope (a provider or a project) has its own set of tabs and its own layout.
export type Tab = {
  id: string;
  kind: "provider" | "project" | "file" | "analysis"; // provider and project tabs are overview pages; for an analysis, path is its id
  provider: string;
  project: string; // project folder, "" for provider-level files
  path: string; // virtual path below the provider root
  title: string;
  preview?: boolean; // replaced by the next file opened with a single click
  view?: { page?: number; scale?: number; sheet?: number; mode?: "document" | "overview"; table?: string };
  jump?: { annoId: string; n: number }; // request to reveal an annotation
};

export type Group = { type: "group"; id: string; tabs: string[]; active: string | null };
export type Split = { type: "split"; id: string; dir: "row" | "col"; children: LayoutNode[]; sizes: number[] };
export type LayoutNode = Group | Split;
export type Zone = "center" | "left" | "right" | "top" | "bottom";
export type Box = { x: number; y: number; w: number; h: number };

const STORE_KEY = "analyzer.workspace.v2";
type Parked = { tabs: Record<string, Tab>; root: LayoutNode; activeGroup: string };
let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const newGroup = (tabs: string[] = []): Group => ({ type: "group", id: uid("g"), tabs, active: tabs[0] ?? null });

export const tabId = (kind: Tab["kind"], provider: string, path: string) => `${kind}:${provider}:${path}`;

class Workspace {
  tabs = $state<Record<string, Tab>>({});
  root = $state<LayoutNode>(newGroup());
  activeGroup = $state("");
  dragging = $state<Tab | null>(null);
  scope = $state(""); // "provider" or "provider|project folder"
  private parked: Record<string, Parked> = {}; // layouts of the scopes that are not showing

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
      if (saved?.scopes) {
        this.parked = saved.scopes;
        this.restore(saved.scope ?? "");
      }
    } catch {
      /* start with an empty workspace */
    }
    if (!this.groups.some((g) => g.id === this.activeGroup)) this.activeGroup = this.groups[0].id;
  }

  private current(): Parked {
    const tabs: Record<string, Tab> = {};
    for (const [id, t] of Object.entries($state.snapshot(this.tabs) as Record<string, Tab>)) tabs[id] = { ...t, jump: undefined };
    return { tabs, root: $state.snapshot(this.root) as LayoutNode, activeGroup: this.activeGroup };
  }

  private restore(scope: string) {
    const next = this.parked[scope];
    delete this.parked[scope];
    this.tabs = next?.tabs ?? {};
    this.root = next?.root ?? newGroup();
    this.activeGroup = next?.activeGroup ?? "";
    this.scope = scope;
    if (!this.groups.some((g) => g.id === this.activeGroup)) this.activeGroup = this.groups[0].id;
  }

  /** Swap the whole workspace for the tabs of another provider or project. */
  setScope(scope: string) {
    if (scope === this.scope) return;
    this.parked[this.scope] = this.current();
    this.restore(scope);
  }

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ scope: this.scope, scopes: { ...this.parked, [this.scope]: this.current() } }));
    } catch {
      /* storage unavailable */
    }
  }

  get groups(): Group[] {
    const out: Group[] = [];
    const walk = (n: LayoutNode): void => {
      if (n.type === "group") out.push(n);
      else n.children.forEach(walk);
    };
    walk(this.root);
    return out;
  }

  get activeTab(): Tab | null {
    const g = this.groups.find((x) => x.id === this.activeGroup);
    return g?.active ? (this.tabs[g.active] ?? null) : null;
  }

  groupOf(id: string): Group | undefined {
    return this.groups.find((g) => g.tabs.includes(id));
  }

  open(tab: Tab, groupId?: string) {
    const existing = this.groupOf(tab.id);
    if (existing) {
      if (tab.jump) this.tabs[tab.id].jump = tab.jump;
      if (!tab.preview) this.tabs[tab.id].preview = false;
      existing.active = tab.id;
      this.activeGroup = existing.id;
      return;
    }
    const g = this.groups.find((x) => x.id === (groupId ?? this.activeGroup)) ?? this.groups[0];
    this.tabs[tab.id] = tab;
    const old = tab.preview ? g.tabs.find((id) => this.tabs[id]?.preview) : undefined;
    if (old) {
      g.tabs[g.tabs.indexOf(old)] = tab.id;
      delete this.tabs[old];
    } else {
      const at = g.active ? g.tabs.indexOf(g.active) + 1 : g.tabs.length;
      g.tabs.splice(at, 0, tab.id);
    }
    g.active = tab.id;
    this.activeGroup = g.id;
  }

  /** Put a tab at the very front without focusing it (used for the overview of a scope). */
  addFirst(tab: Tab) {
    if (this.groupOf(tab.id)) return;
    const g = this.groups[0];
    this.tabs[tab.id] = tab;
    g.tabs.unshift(tab.id);
    g.active ??= tab.id;
  }

  pin(id: string) {
    if (this.tabs[id]?.preview) this.tabs[id].preview = false;
  }

  closeAll(groupId: string) {
    const g = this.groups.find((x) => x.id === groupId);
    if (!g) return;
    for (const id of g.tabs) delete this.tabs[id];
    g.tabs = [];
    g.active = null;
    this.cleanup();
  }

  /** Switch to the next or previous tab in the active group. */
  cycle(step: number) {
    const g = this.groups.find((x) => x.id === this.activeGroup);
    if (!g || g.tabs.length < 2 || !g.active) return;
    g.active = g.tabs[(g.tabs.indexOf(g.active) + step + g.tabs.length) % g.tabs.length];
  }

  activate(groupId: string, id?: string) {
    const g = this.groups.find((x) => x.id === groupId);
    if (!g) return;
    if (id) g.active = id;
    this.activeGroup = groupId;
  }

  close(id: string) {
    const g = this.groupOf(id);
    if (!g) return;
    this.detach(g, id);
    delete this.tabs[id];
    this.cleanup();
  }

  closeOthers(groupId: string, keep: string) {
    const g = this.groups.find((x) => x.id === groupId);
    if (!g) return;
    for (const id of g.tabs) if (id !== keep) delete this.tabs[id];
    g.tabs = [keep];
    g.active = keep;
  }

  private detach(g: Group, id: string) {
    const i = g.tabs.indexOf(id);
    g.tabs.splice(i, 1);
    if (g.active === id) g.active = g.tabs[Math.min(i, g.tabs.length - 1)] ?? null;
  }

  /** Move a tab (or open a new one) into a group, or split that group on one side. */
  drop(tab: Tab, targetId: string, zone: Zone, index?: number) {
    const target = this.groups.find((g) => g.id === targetId);
    if (!target) return;
    const source = this.groupOf(tab.id);
    if (!source) this.tabs[tab.id] = tab;
    this.tabs[tab.id].preview = false;
    if (zone === "center") {
      let at = index ?? target.tabs.length;
      if (source) {
        const from = source.tabs.indexOf(tab.id);
        if (source === target && from < at) at--;
        this.detach(source, tab.id);
      }
      target.tabs.splice(Math.min(at, target.tabs.length), 0, tab.id);
      target.active = tab.id;
      this.activeGroup = target.id;
    } else {
      if (source === target && target.tabs.length === 1) return;
      if (source) this.detach(source, tab.id);
      const fresh = newGroup([tab.id]);
      const dir = zone === "left" || zone === "right" ? "row" : "col";
      const before = zone === "left" || zone === "top";
      const parent = this.parentOf(target.id);
      if (parent && parent.dir === dir) {
        const i = parent.children.findIndex((c) => c.id === target.id);
        const half = parent.sizes[i] / 2;
        parent.sizes.splice(i, 1, half, half);
        parent.children.splice(before ? i : i + 1, 0, fresh);
      } else {
        const idx = parent ? parent.children.findIndex((c) => c.id === target.id) : -1;
        const keep = $state.snapshot(target) as Group;
        const split: Split = { type: "split", id: uid("s"), dir, children: before ? [fresh, keep] : [keep, fresh], sizes: [0.5, 0.5] };
        if (parent) parent.children[idx] = split;
        else this.root = split;
      }
      this.activeGroup = fresh.id;
    }
    this.cleanup();
  }

  private parentOf(id: string, node: LayoutNode = this.root): Split | null {
    if (node.type === "group") return null;
    for (const c of node.children) {
      if (c.id === id) return node;
      const hit = this.parentOf(id, c);
      if (hit) return hit;
    }
    return null;
  }

  /** Remove empty groups and collapse splits that have a single child left. */
  private cleanup() {
    const prune = (n: LayoutNode): LayoutNode | null => {
      if (n.type === "group") return n.tabs.length ? n : null;
      const kept: LayoutNode[] = [];
      const sizes: number[] = [];
      n.children.forEach((c, i) => {
        const p = prune(c);
        if (p) {
          kept.push(p);
          sizes.push(n.sizes[i]);
        }
      });
      if (!kept.length) return null;
      if (kept.length === 1) return kept[0];
      const total = sizes.reduce((a, b) => a + b, 0);
      return { ...n, children: kept, sizes: sizes.map((s) => s / total) };
    };
    this.root = prune($state.snapshot(this.root) as LayoutNode) ?? newGroup();
    if (!this.groups.some((g) => g.id === this.activeGroup)) this.activeGroup = this.groups[0].id;
  }

  resize(splitId: string, index: number, delta: number) {
    const find = (n: LayoutNode): Split | null => {
      if (n.type === "group") return null;
      if (n.id === splitId) return n;
      for (const c of n.children) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const s = find(this.root);
    if (!s) return;
    const pair = s.sizes[index] + s.sizes[index + 1];
    const min = Math.min(0.08, pair / 2);
    const a = Math.min(Math.max(s.sizes[index] + delta, min), pair - min);
    s.sizes[index] = a;
    s.sizes[index + 1] = pair - a;
  }

  /** Geometry in fractions of the workspace area. */
  get layout() {
    const groups: { group: Group; box: Box }[] = [];
    const splitters: { split: Split; index: number; box: Box; span: number }[] = [];
    const walk = (n: LayoutNode, box: Box) => {
      if (n.type === "group") {
        groups.push({ group: n, box });
        return;
      }
      let offset = 0;
      n.children.forEach((c, i) => {
        const s = n.sizes[i];
        const child: Box =
          n.dir === "row"
            ? { x: box.x + offset * box.w, y: box.y, w: s * box.w, h: box.h }
            : { x: box.x, y: box.y + offset * box.h, w: box.w, h: s * box.h };
        walk(c, child);
        offset += s;
        if (i < n.children.length - 1) {
          splitters.push({
            split: n,
            index: i,
            span: n.dir === "row" ? box.w : box.h,
            box:
              n.dir === "row"
                ? { x: box.x + offset * box.w, y: box.y, w: 0, h: box.h }
                : { x: box.x, y: box.y + offset * box.h, w: box.w, h: 0 },
          });
        }
      });
    };
    walk(this.root, { x: 0, y: 0, w: 1, h: 1 });
    return { groups, splitters };
  }
}

export const ws = new Workspace();
