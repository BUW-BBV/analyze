<script lang="ts">
  import ContextMenu from "./components/ContextMenu.svelte";
  import Icon from "./components/Icon.svelte";
  import QuickOpen from "./components/QuickOpen.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TagDialog from "./components/TagDialog.svelte";
  import TopBar from "./components/TopBar.svelte";
  import Workspace from "./components/Workspace.svelte";
  import { t } from "./lib/i18n.svelte";
  import { app } from "./lib/state.svelte";
  import { ws } from "./lib/workspace.svelte";

  const RAIL = 36;
  let sidebarW = $state(Number(localStorage.getItem("analyzer.sidebar.width")) || 330);
  // Unpinned, the navigation slides out while the pointer is over the rail or the panel.
  let peek = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  void app.load();

  // Persist the tab layout whenever it changes.
  $effect(() => {
    JSON.stringify([ws.tabs, ws.root, ws.activeGroup, ws.scope]);
    ws.save();
  });

  function enter() {
    clearTimeout(closeTimer);
    peek = true;
  }
  function leave() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      // keep it open while a menu or dialog that belongs to it is showing
      if (!app.menu && !document.querySelector("dialog[open]")) peek = false;
    }, 280);
  }

  function dragWidth(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => (sidebarW = Math.min(640, Math.max(220, ev.clientX)));
    el.addEventListener("pointermove", move);
    el.addEventListener(
      "pointerup",
      () => {
        el.removeEventListener("pointermove", move);
        localStorage.setItem("analyzer.sidebar.width", String(sidebarW));
      },
      { once: true },
    );
  }

  function onKey(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.ctrlKey && (key === "k" || key === "p")) {
      e.preventDefault();
      app.paletteOpen = !app.paletteOpen;
    } else if (e.ctrlKey && key === "b") {
      e.preventDefault();
      app.toggleSidebar();
    } else if (e.altKey && key === "w" && ws.activeTab) {
      e.preventDefault();
      ws.close(ws.activeTab.id);
    } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !typing) {
      e.preventDefault();
      ws.cycle(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Escape" && peek) {
      peek = false;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <TopBar />
  <div class="body" style:grid-template-columns="{app.sidebarPinned ? sidebarW : RAIL}px 1fr">
    {#if app.sidebarPinned}
      <div class="docked"><Sidebar /></div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="rail" onpointerenter={enter} onpointerleave={leave}>
        <button class="icon-btn" title={t("Show navigation")} aria-expanded={peek} onclick={() => (peek = !peek)} onfocus={enter}>
          <Icon name="folder" />
        </button>
        <span class="rail-label">{t("Projects")}</span>
      </div>
    {/if}
    <main><Workspace /></main>

    {#if app.sidebarPinned}
      <div class="resizer" style:left="{sidebarW - 3}px" onpointerdown={dragWidth} role="separator" aria-orientation="vertical"></div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class={["flyout", { open: peek && !ws.dragging }]}
        style:width="{sidebarW}px"
        style:left="{RAIL}px"
        inert={!peek}
        onpointerenter={enter}
        onpointerleave={leave}
      >
        <Sidebar />
      </div>
    {/if}
  </div>
</div>
<QuickOpen />
<TagDialog />
<ContextMenu />

<style>
  .app {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
  }
  .body {
    display: grid;
    position: relative;
    min-height: 0;
  }
  .docked,
  main {
    min-width: 0;
    min-height: 0;
  }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding-top: 8px;
    background: var(--bg);
    border-right: 1px solid var(--border);
  }
  .rail-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    user-select: none;
  }
  .flyout {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 50;
    border-right: 1px solid var(--border);
    box-shadow: 12px 0 28px rgb(15 20 28 / 0.16);
    translate: -12px 0;
    opacity: 0;
    visibility: hidden;
    transition:
      translate 140ms ease-out,
      opacity 140ms ease-out,
      visibility 0s 140ms;
  }
  .flyout.open {
    translate: 0 0;
    opacity: 1;
    visibility: visible;
    transition:
      translate 140ms ease-out,
      opacity 140ms ease-out;
  }
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    z-index: 40;
    cursor: col-resize;
    touch-action: none;
  }
  .resizer:hover {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
</style>
