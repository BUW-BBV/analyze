<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { fileMenu } from "../lib/menus";
  import { app } from "../lib/state.svelte";
  import { ws, type Box, type Group, type Tab, type Zone } from "../lib/workspace.svelte";
  import AnalysisView from "./AnalysisView.svelte";
  import DocView from "./DocView.svelte";
  import FileName from "./FileName.svelte";
  import Overview from "./Overview.svelte";
  import Icon from "./Icon.svelte";

  let host: HTMLElement;
  let hover = $state<{ group: string; zone: Zone; index?: number } | null>(null);

  let layout = $derived(ws.layout);
  let placed = $derived(
    layout.groups.flatMap(({ group, box }) =>
      group.tabs.filter((id) => ws.tabs[id]).map((id) => ({ tab: ws.tabs[id], group, box, active: group.active === id })),
    ),
  );

  const pct = (n: number) => `${n * 100}%`;
  const boxStyle = (b: Box) => `left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}`;

  function zoneAt(e: DragEvent): Zone {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const edge = 0.24;
    const d = [x, 1 - x, y, 1 - y];
    const min = Math.min(...d);
    if (min > edge) return "center";
    return (["left", "right", "top", "bottom"] as const)[d.indexOf(min)];
  }

  function tabIndexAt(e: DragEvent, group: Group): number {
    const bar = e.currentTarget as HTMLElement;
    const tabs = [...bar.querySelectorAll<HTMLElement>("[data-tab]")];
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) return i;
    }
    return group.tabs.length;
  }

  function finishDrop(e: DragEvent) {
    e.preventDefault();
    if (ws.dragging && hover) ws.drop($state.snapshot(ws.dragging) as Tab, hover.group, hover.zone, hover.index);
    ws.dragging = null;
    hover = null;
  }

  function dragSplitter(e: PointerEvent, s: (typeof layout.splitters)[number]) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = s.split.dir === "row" ? e.clientX : e.clientY;
    const total = (s.split.dir === "row" ? host.clientWidth : host.clientHeight) * s.span;
    const move = (ev: PointerEvent) => {
      const now = s.split.dir === "row" ? ev.clientX : ev.clientY;
      ws.resize(s.split.id, s.index, (now - last) / total);
      last = now;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", () => el.removeEventListener("pointermove", move), { once: true });
  }

  const previewStyle = (zone: Zone) =>
    ({
      center: "inset:0",
      left: "inset:0 50% 0 0",
      right: "inset:0 0 0 50%",
      top: "inset:0 0 50% 0",
      bottom: "inset:50% 0 0 0",
    })[zone];

  function onTabClick(group: Group, tab: Tab) {
    ws.activate(group.id, tab.id);
  }

  function tabMenu(e: MouseEvent, group: Group, tab: Tab) {
    const snap = () => $state.snapshot(tab) as Tab;
    app.showMenu(e, [
      { label: t("Close"), action: () => ws.close(tab.id) },
      { label: t("Close others"), action: () => ws.closeOthers(group.id, tab.id) },
      { label: t("Close all"), action: () => ws.closeAll(group.id) },
      ...(tab.preview ? [{ label: t("Keep open"), action: () => ws.pin(tab.id), separator: true }] : []),
      { label: t("Move to the right"), action: () => ws.drop(snap(), group.id, "right"), separator: true },
      { label: t("Move below"), action: () => ws.drop(snap(), group.id, "bottom") },
      ...(tab.project ? [{ label: t("Show project in sidebar"), action: () => app.revealProject(tab.provider, tab.project), separator: true }] : []),
      ...(tab.kind === "file" ? fileMenu(tab.provider, tab.path).slice(2) : []),
    ]);
  }
</script>

<div class="ws" bind:this={host}>
  {#each layout.groups as { group, box } (group.id)}
    <div
      class={["group", { focused: ws.activeGroup === group.id }]}
      style={boxStyle(box)}
      onpointerdowncapture={() => ws.activate(group.id)}
    >
      <div
        class="tabbar"
        role="tablist"
        tabindex="-1"
        ondragover={(e) => {
          if (!ws.dragging) return;
          e.preventDefault();
          hover = { group: group.id, zone: "center", index: tabIndexAt(e, group) };
        }}
        ondrop={finishDrop}
      >
        {#each group.tabs as id, i (id)}
          {@const tab = ws.tabs[id]}
          {#if tab}
            {#if hover?.group === group.id && hover.index === i}<span class="insert"></span>{/if}
            <div
              class={["tab", { active: group.active === id, "is-preview": tab.preview }]}
              data-tab={id}
              role="tab"
              tabindex="0"
              aria-selected={group.active === id}
              draggable="true"
              title={tab.preview ? `${tab.path}\n${t("Preview: double-click to keep this tab open")}` : tab.path}
              ondblclick={() => ws.pin(id)}
              oncontextmenu={(e) => tabMenu(e, group, tab)}
              ondragstart={(e) => {
                ws.dragging = tab;
                e.dataTransfer?.setData("text/plain", tab.title);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
              }}
              ondragend={() => {
                ws.dragging = null;
                hover = null;
              }}
              onclick={() => onTabClick(group, tab)}
              onkeydown={(e) => e.key === "Enter" && onTabClick(group, tab)}
              onauxclick={(e) => e.button === 1 && ws.close(id)}
            >
              {#if tab.kind === "analysis"}
                <Icon name="analysis" size={14} />
                <span class="ellipsis">{tab.title}</span>
              {:else if tab.kind === "provider"}
                <Icon name="home" size={14} />
                <span class="ellipsis">{tab.title}</span>
              {:else if tab.kind === "project"}
                <Icon name="home" size={14} />
                <span class="plate">{tab.title}</span>
              {:else}
                <FileName name={tab.title} />
              {/if}
              <button
                class="x"
                aria-label={t("Close {name}", { name: tab.title })}
                onclick={(e) => {
                  e.stopPropagation();
                  ws.close(id);
                }}><Icon name="close" size={12} /></button
              >
            </div>
          {/if}
        {/each}
        {#if hover?.group === group.id && hover.index === group.tabs.length}<span class="insert"></span>{/if}
        <span class="spacer"></span>
        {#if group.tabs.length > 1 && group.active}
          {@const active = ws.tabs[group.active]}
          <button class="icon-btn" title={t("Move this tab to a new group on the right")} onclick={() => ws.drop($state.snapshot(active) as Tab, group.id, "right")}>
            <Icon name="splitRight" size={14} />
          </button>
          <button class="icon-btn" title={t("Move this tab to a new group below")} onclick={() => ws.drop($state.snapshot(active) as Tab, group.id, "bottom")}>
            <Icon name="splitDown" size={14} />
          </button>
        {/if}
      </div>

      {#if !group.tabs.length}
        <div class="home">
          <p>{t("No tabs open here.")}</p>
          {#if app.selected}
            {@const sel = app.selected}
            <button class="btn primary" onclick={() => (sel.folder ? app.openProject(sel.provider, sel.folder, true) : app.openProvider(sel.provider, true))}>{t("Open overview")}</button>
          {/if}
        </div>
      {/if}

      {#if ws.dragging}
        <div
          class="dropzone"
          role="presentation"
          ondragover={(e) => {
            e.preventDefault();
            hover = { group: group.id, zone: group.tabs.length ? zoneAt(e) : "center" };
          }}
          ondragleave={() => (hover = null)}
          ondrop={finishDrop}
        >
          {#if hover?.group === group.id && hover.index === undefined}
            <div class="preview" style={previewStyle(hover.zone)}></div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#each placed as { tab, group, box, active } (tab.id)}
    <div class={["panel", { hidden: !active }]} style={boxStyle(box)} inert={!active} onpointerdowncapture={() => ws.activate(group.id)}>
      {#if tab.kind === "analysis"}
        <AnalysisView {tab} />
      {:else if tab.kind !== "file"}
        <Overview {tab} />
      {:else}
        <DocView {tab} {active} />
      {/if}
    </div>
  {/each}

  {#each layout.splitters as s (s.split.id + ":" + s.index)}
    <div
      class={["splitter", s.split.dir]}
      style="left:{pct(s.box.x)};top:{pct(s.box.y)};{s.split.dir === 'row' ? `height:${pct(s.box.h)}` : `width:${pct(s.box.w)}`}"
      onpointerdown={(e) => dragSplitter(e, s)}
      role="separator"
    ></div>
  {/each}
</div>

<style>
  .ws {
    position: relative;
    height: 100%;
    background: var(--surface);
    overflow: hidden;
  }
  .group {
    position: absolute;
    border-left: 1px solid var(--border);
    border-top: 1px solid var(--border);
  }
  .tabbar {
    display: flex;
    align-items: stretch;
    height: var(--tabbar);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    padding-right: 4px;
  }
  .tabbar .icon-btn {
    align-self: center;
  }
  .spacer {
    flex: 1;
    min-width: 12px;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 240px;
    min-width: 0;
    flex: 0 1 auto;
    padding: 0 4px 0 10px;
    border-right: 1px solid var(--border);
    color: var(--text-2);
    cursor: pointer;
    user-select: none;
    position: relative;
  }
  .tab:hover {
    background: var(--surface-3);
  }
  .tab.active {
    background: var(--surface);
    color: var(--text);
    margin-bottom: -1px;
  }
  .tab.is-preview :global(.name) {
    font-style: italic;
  }
  .group.focused .tab.active::before {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    background: var(--accent);
  }
  .tab .plate {
    color: var(--accent-text);
    font-size: 13px;
  }
  .x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    flex: none;
    opacity: 0;
  }
  .tab:hover .x,
  .tab.active .x,
  .x:focus-visible {
    opacity: 0.7;
  }
  .x:hover {
    background: var(--surface-3);
    opacity: 1;
  }
  .insert {
    width: 2px;
    background: var(--accent);
    flex: none;
  }
  .panel {
    position: absolute;
    padding-top: calc(var(--tabbar) + 1px);
    padding-left: 1px;
    pointer-events: none;
  }
  .panel > :global(*) {
    pointer-events: auto;
  }
  .panel.hidden {
    visibility: hidden;
  }
  .panel.hidden > :global(*) {
    pointer-events: none;
  }
  .home {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 4px;
    background: var(--surface);
    color: var(--text-2);
  }
  .group:has(.home) .tabbar {
    display: none;
  }
  .dropzone {
    position: absolute;
    inset: var(--tabbar) 0 0 0;
    z-index: 30;
  }
  .preview {
    position: absolute;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border: 2px solid var(--accent);
    border-radius: 4px;
    pointer-events: none;
    transition: inset 80ms;
  }
  .splitter {
    position: absolute;
    z-index: 20;
    touch-action: none;
  }
  .splitter.row {
    width: 7px;
    margin-left: -3px;
    cursor: col-resize;
  }
  .splitter.col {
    height: 7px;
    margin-top: -3px;
    cursor: row-resize;
  }
  .splitter:hover {
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }
</style>
