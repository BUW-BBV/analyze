<script lang="ts" generics="R">
  import { COLORS, STATUS_COLOR, type ViewConfig } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { app } from "../lib/state.svelte";
  import { display, filterAndSort, isVisible, layout, toCsv, withDefaults, type Column } from "../lib/table";
  import FileName from "./FileName.svelte";
  import Icon from "./Icon.svelte";

  // One table for every level. `kind` names the level; saved views are shared by all tables of that kind.
  let {
    kind,
    columns,
    rows,
    rowKey,
    builtins,
    empty,
    isActive,
    onOpen,
    onMenu,
  }: {
    kind: string;
    columns: Column<R>[];
    rows: R[];
    rowKey: (row: R) => string;
    builtins: { name: string; config: Partial<ViewConfig> }[];
    empty: string;
    isActive?: (row: R) => boolean;
    onOpen?: (row: R, keep: boolean) => void;
    onMenu?: (e: MouseEvent, row: R) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const STORE = `analyzer.table.${kind}`;
  type Current = { view: string; config: ViewConfig };

  function initial(): Current {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
      if (saved?.config) return { view: saved.view ?? "builtin:0", config: withDefaults(saved.config) };
    } catch {
      /* fall through to the first built-in view */
    }
    // svelte-ignore state_referenced_locally
    return { view: "builtin:0", config: withDefaults(builtins[0]?.config) };
  }

  let cur = $state<Current>(initial());
  let collapsed = $state(new Set<string>());
  let popover = $state<"columns" | "groups" | null>(null);
  let naming = $state<{ id?: string; name: string } | null>(null);

  let views = $derived([
    ...builtins.map((b, i) => ({ id: `builtin:${i}`, name: b.name, config: withDefaults(b.config), builtin: true })),
    ...app.views.filter((v) => v.kind === kind).map((v) => ({ ...v, config: withDefaults(v.config), builtin: false })),
  ]);
  let base = $derived(views.find((v) => v.id === cur.view) ?? views[0]);
  let dirty = $derived(JSON.stringify(cur.config) !== JSON.stringify(base.config));

  let c = $derived(cur.config);
  let visible = $derived(columns.filter((col) => isVisible(col, c)));
  let byId = $derived(new Map(columns.map((col) => [col.id, col])));
  let shown = $derived(filterAndSort(rows, columns, c));
  let items = $derived(layout(shown, columns, c, rowKey, collapsed));
  let template = $derived(visible.map((col) => col.width ?? "minmax(120px, 1fr)").join(" "));
  let filterCount = $derived(Object.values(c.filters).filter((q) => q.trim()).length);

  function change(fn: (config: ViewConfig) => void) {
    fn(cur.config);
    localStorage.setItem(STORE, JSON.stringify($state.snapshot(cur)));
  }

  function selectView(id: string) {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    cur = { view: id, config: JSON.parse(JSON.stringify(v.config)) };
    collapsed = new Set();
    localStorage.setItem(STORE, JSON.stringify($state.snapshot(cur)));
  }

  async function saveView() {
    if (base.builtin) return void (naming = { name: "" });
    await app.saveView({ id: base.id, kind, name: base.name, config: $state.snapshot(cur.config) });
  }

  async function finishNaming() {
    if (!naming) return;
    const name = naming.name.trim();
    const id = naming.id;
    naming = null;
    if (!name) return;
    const existing = id ? app.views.find((v) => v.id === id) : undefined;
    const saved = await app.saveView({ id, kind, name, config: existing ? existing.config : $state.snapshot(cur.config) });
    if (!id) selectView(saved.id);
  }

  function viewMenu(e: MouseEvent, v: (typeof views)[number]) {
    if (v.builtin) return;
    app.showMenu(e, [
      { label: t("Rename"), action: () => (naming = { id: v.id, name: v.name }) },
      {
        label: t("Delete view"),
        danger: true,
        action: () => {
          if (cur.view === v.id) selectView("builtin:0");
          void app.deleteView(v.id);
        },
      },
    ]);
  }

  function sortBy(id: string, additive: boolean, dir?: 1 | -1) {
    change((cfg) => {
      const at = cfg.sort.findIndex((s) => s.id === id);
      const now = at >= 0 ? cfg.sort[at].dir : 0;
      const next = dir ?? (now === 1 ? -1 : now === -1 ? 0 : 1);
      const entry = next ? [{ id, dir: next as 1 | -1 }] : [];
      if (!additive) cfg.sort = entry;
      else if (at >= 0) cfg.sort.splice(at, 1, ...entry);
      else cfg.sort.push(...entry);
    });
  }

  const toggleGroup = (id: string) =>
    change((cfg) => {
      cfg.groups = cfg.groups.includes(id) ? cfg.groups.filter((g) => g !== id) : [...cfg.groups, id];
    });

  function toggleColumn(col: Column<R>) {
    change((cfg) => {
      const on = isVisible(col, cfg);
      cfg.hidden = cfg.hidden.filter((x) => x !== col.id);
      cfg.shown = cfg.shown.filter((x) => x !== col.id);
      if (on && !col.hidden) cfg.hidden.push(col.id);
      if (!on && col.hidden) cfg.shown.push(col.id);
    });
  }

  function headMenu(e: MouseEvent, col: Column<R>) {
    const grouped = c.groups.includes(col.id);
    app.showMenu(e, [
      { label: t("Sort ascending"), action: () => sortBy(col.id, false, 1) },
      { label: t("Sort descending"), action: () => sortBy(col.id, false, -1) },
      { label: grouped ? t("Stop grouping by this column") : t("Group by this column"), action: () => toggleGroup(col.id), separator: true },
      { label: t("Filter this column"), action: () => change((cfg) => (cfg.showFilters = true)) },
      { label: t("Hide column"), action: () => toggleColumn(col), separator: true },
    ]);
  }

  function toggleCollapsed(key: string) {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    collapsed = next;
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(shown, visible)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const focusNow = (el: HTMLInputElement) => el.focus();
  const numeric = (col: Column<R>) => col.type === "number" || col.type === "size" || col.cell === "count";
</script>

<div class="dt">
  <div class="views" role="tablist" aria-label={t("Views")}>
    {#each views as v (v.id)}
      {#if naming?.id === v.id}
        <input class="vname" type="text" bind:value={naming.name} onkeydown={(e) => (e.key === "Enter" ? finishNaming() : e.key === "Escape" && (naming = null))} onblur={finishNaming} {@attach focusNow} />
      {:else}
        <button role="tab" aria-selected={v.id === base.id} class={["view", { on: v.id === base.id }]} onclick={() => selectView(v.id)} oncontextmenu={(e) => viewMenu(e, v)} title={v.builtin ? undefined : t("Right-click to rename or delete")}>
          {v.name}{#if v.id === base.id && dirty}<span class="dot" title={t("Changed, not saved")}></span>{/if}
        </button>
      {/if}
    {/each}
    {#if naming && !naming.id}
      <input class="vname" type="text" placeholder={t("Name of the view")} bind:value={naming.name} onkeydown={(e) => (e.key === "Enter" ? finishNaming() : e.key === "Escape" && (naming = null))} onblur={finishNaming} {@attach focusNow} />
    {:else}
      <button class="view add" onclick={() => (naming = { name: "" })} title={t("Save the current columns, filters, grouping and sorting as a new view")}><Icon name="plus" size={12} /> {t("New view")}</button>
    {/if}
    {#if dirty}
      <span class="grow"></span>
      {#if !base.builtin}<button class="link" onclick={saveView}>{t("Save changes to “{name}”", { name: base.name })}</button>{/if}
      <button class="link" onclick={() => selectView(base.id)}>{t("Reset")}</button>
    {/if}
  </div>

  <div class="bar">
    <div class="pop-wrap">
      <button class={["tool", { on: popover === "columns" }]} onclick={() => (popover = popover === "columns" ? null : "columns")}>
        <Icon name="columns" size={14} /> {t("Columns")}
      </button>
      {#if popover === "columns"}
        <div class="pop">
          {#each columns as col (col.id)}
            <label><input type="checkbox" checked={isVisible(col, c)} onchange={() => toggleColumn(col)} /> {col.label}</label>
          {/each}
        </div>
      {/if}
    </div>
    <div class="pop-wrap">
      <button class={["tool", { on: popover === "groups", set: c.groups.length > 0 }]} onclick={() => (popover = popover === "groups" ? null : "groups")}>
        <Icon name="group" size={14} />
        {t("Group")}{#if c.groups.length}: {c.groups.map((g) => byId.get(g)?.label ?? g).join(" › ")}{/if}
      </button>
      {#if popover === "groups"}
        <div class="pop">
          {#if c.groups.length}
            <p class="pop-h">{t("Grouped by, outermost first")}</p>
            {#each c.groups as g, i (g)}
              <div class="grow-row">
                <span class="n">{i + 1}</span>
                <span class="ellipsis">{byId.get(g)?.label ?? g}</span>
                <button class="icon-btn" title={t("Move up")} disabled={i === 0} onclick={() => change((cfg) => cfg.groups.splice(i - 1, 2, cfg.groups[i], cfg.groups[i - 1]))}><Icon name="up" size={12} /></button>
                <button class="icon-btn" title={t("Remove")} onclick={() => toggleGroup(g)}><Icon name="close" size={12} /></button>
              </div>
            {/each}
            <hr />
          {/if}
          <p class="pop-h">{c.groups.length ? t("Add another level") : t("Group rows by")}</p>
          {#each columns.filter((col) => !c.groups.includes(col.id)) as col (col.id)}
            <button class="pick" onclick={() => toggleGroup(col.id)}>{col.label}</button>
          {/each}
        </div>
      {/if}
    </div>
    <button class={["tool", { on: c.showFilters, set: filterCount > 0 }]} onclick={() => change((cfg) => (cfg.showFilters = !cfg.showFilters))}>
      <Icon name="filter" size={14} />
      {t("Filter")}{#if filterCount}&nbsp;<span class="badge">{filterCount}</span>{/if}
    </button>
    {#if filterCount}
      <button class="link" onclick={() => change((cfg) => (cfg.filters = {}))}>{t("Clear filters")}</button>
    {/if}
    <span class="grow"></span>
    <span class="muted">{shown.length === rows.length ? t("{n} rows", { n: rows.length }) : t("{n} of {total} rows", { n: shown.length, total: rows.length })}</span>
    <button class="tool" onclick={exportCsv} title={t("Export the rows and columns shown as CSV")}><Icon name="download" size={14} /> CSV</button>
  </div>
  {#if popover}<div class="veil" role="presentation" onpointerdown={() => (popover = null)}></div>{/if}

  <div class="scroll" style:--cols={template}>
    <div class="sticky">
      <div class="tr head">
        {#each visible as col (col.id)}
          {@const s = c.sort.findIndex((x) => x.id === col.id)}
          <button
            class={["th", { num: numeric(col), sorted: s >= 0 }]}
            onclick={(e) => sortBy(col.id, e.shiftKey)}
            oncontextmenu={(e) => headMenu(e, col)}
            title={t("Click to sort, Shift-click to add a second sort, right-click for more")}
          >
            <span class="ellipsis">{col.label}</span>
            {#if s >= 0}<span class="arrow">{c.sort[s].dir === 1 ? "↑" : "↓"}{c.sort.length > 1 ? s + 1 : ""}</span>{/if}
          </button>
        {/each}
      </div>
      {#if c.showFilters}
        <div class="tr filters">
          {#each visible as col (col.id)}
            <input
              type="search"
              value={c.filters[col.id] ?? ""}
              placeholder={numeric(col) ? t("e.g. >10") : t("Filter")}
              aria-label={t("Filter {label}", { label: col.label })}
              oninput={(e) => change((cfg) => (cfg.filters[col.id] = e.currentTarget.value))}
            />
          {/each}
        </div>
      {/if}
    </div>

    {#each items as item (item.key)}
      {#if item.type === "group"}
        <button class="group" style:padding-left="{8 + item.depth * 18}px" onclick={() => toggleCollapsed(item.key)} aria-expanded={item.open}>
          <span class={["twist", { open: item.open }]}><Icon name="chevron" size={12} /></span>
          <span class="gcol">{item.column}</span>
          <span class="glabel ellipsis">{item.label}</span>
          <span class="gcount">{item.count}</span>
        </button>
      {:else}
        {@const row = item.row}
        <div
          class={["tr", "row", { active: isActive?.(row) }]}
          role="button"
          tabindex="0"
          onclick={() => onOpen?.(row, false)}
          ondblclick={() => onOpen?.(row, true)}
          onkeydown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen?.(row, true)}
          oncontextmenu={(e) => onMenu?.(e, row)}
        >
          {#each visible as col, i (col.id)}
            {@const v = col.get(row)}
            <span class={["td", { num: numeric(col) }]} style:padding-left={i === 0 && item.depth ? `${10 + item.depth * 18}px` : undefined}>
              {#if col.cell === "file"}
                <FileName name={String(v ?? "")} />
              {:else if col.cell === "plate"}
                <span class="plate">{v || "–"}</span>
              {:else if col.cell === "status"}
                {#if v}<i class="sdot" style:background={STATUS_COLOR[String(v)] ?? "var(--text-3)"}></i><span class="ellipsis">{t(String(v))}</span>{/if}
              {:else if col.cell === "count"}
                {#if v}<span class="count">{v}</span>{/if}
              {:else if col.cell === "color"}
                <i class="sdot" style:background={COLORS[String(v)] ?? COLORS.yellow}></i><span class="ellipsis">{t(String(v ?? ""))}</span>
              {:else if Array.isArray(v)}
                {#each v as tag (tag)}<i class="chip">{tag}</i>{/each}
              {:else}
                {@const text = display(col, row)}
                <span class="ellipsis" title={text.length > 30 ? text : undefined}>{text}</span>
              {/if}
            </span>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="empty">
        {#if rows.length}
          {t("No rows match the filters of this view.")} <button class="link" onclick={() => change((cfg) => (cfg.filters = {}))}>{t("Clear filters")}</button>
        {:else}
          {empty}
        {/if}
      </p>
    {/each}
  </div>
</div>

<style>
  .dt {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    position: relative;
  }
  .grow {
    flex: 1;
  }
  .views {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    min-height: 34px;
    flex: none;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .view {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 34px;
    padding: 0 10px;
    color: var(--text-2);
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .view:hover {
    color: var(--text);
  }
  .view.on {
    color: var(--text);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  .view.add {
    color: var(--text-3);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--yellow);
  }
  .vname {
    width: 170px;
    height: 24px;
    padding: 0 6px;
  }
  .link {
    color: var(--accent-text);
    white-space: nowrap;
    padding: 0 6px;
  }
  .link:hover {
    text-decoration: underline;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 16px;
    flex: none;
    font-size: 12.5px;
    position: relative;
    z-index: 6;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border-radius: 5px;
    color: var(--text-2);
    white-space: nowrap;
    max-width: 340px;
    overflow: hidden;
  }
  .tool:hover,
  .tool.on {
    background: var(--surface-3);
    color: var(--text);
  }
  .tool.set {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .badge {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    line-height: 16px;
    text-align: center;
  }
  .pop-wrap {
    position: relative;
  }
  .pop {
    position: absolute;
    top: 30px;
    left: 0;
    z-index: 7;
    min-width: 220px;
    max-height: 380px;
    overflow-y: auto;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .pop label,
  .pick {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    border-radius: 5px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .pop label:hover,
  .pick:hover {
    background: var(--accent-soft);
  }
  .pop-h {
    margin: 4px 8px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-3);
  }
  .grow-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 2px 1px 8px;
  }
  .grow-row .ellipsis {
    flex: 1;
  }
  .grow-row .n {
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .pop hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 6px 0;
  }
  .veil {
    position: fixed;
    inset: 0;
    z-index: 5;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--border);
  }
  .sticky {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    min-width: fit-content;
  }
  .tr {
    display: grid;
    grid-template-columns: var(--cols);
    align-items: center;
    column-gap: 14px;
    padding: 0 16px;
    min-width: fit-content;
  }
  .head {
    height: 30px;
  }
  .th {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-align: left;
  }
  .th:hover,
  .th.sorted {
    color: var(--text);
  }
  .th.num {
    justify-content: flex-end;
  }
  .arrow {
    color: var(--accent-text);
    flex: none;
  }
  .filters {
    padding-bottom: 6px;
  }
  .filters input {
    height: 24px;
    padding: 0 6px;
    font-size: 12px;
    min-width: 0;
  }
  .row {
    height: 32px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .row:hover {
    background: var(--accent-soft);
  }
  .row.active {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .td {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .td.num {
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .td .plate {
    color: var(--accent-text);
  }
  .sdot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .chip {
    flex: none;
    font-style: normal;
    height: 19px;
    line-height: 19px;
    padding: 0 7px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 11.5px;
    font-weight: 600;
  }
  .row:hover .chip,
  .row.active .chip {
    background: var(--surface);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: fit-content;
    height: 30px;
    padding-right: 16px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    text-align: left;
    position: sticky;
    left: 0;
  }
  .group:hover {
    background: var(--surface-3);
  }
  .twist {
    color: var(--text-3);
    transition: transform 100ms;
  }
  .twist.open {
    transform: rotate(90deg);
  }
  .gcol {
    color: var(--text-3);
    font-size: 12px;
  }
  .glabel {
    font-weight: 600;
  }
  .gcount {
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: 0;
    padding: 24px 16px;
    color: var(--text-2);
  }
</style>
