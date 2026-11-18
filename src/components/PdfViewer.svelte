<script lang="ts">
  import { onDestroy, tick, untrack, type Snippet } from "svelte";
  import { COLORS, fileUrl, type Annotation, type Rect } from "../lib/api";
  import { mergeLineRects, openPdf, type PdfDoc } from "../lib/pdf";
  import { t } from "../lib/i18n.svelte";
  import { qia } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";
  import { ws, type Tab } from "../lib/workspace.svelte";
  import Icon from "./Icon.svelte";
  import PdfPage from "./PdfPage.svelte";

  let {
    tab,
    annos,
    actions,
    onCreate,
  }: { tab: Tab; annos: Annotation[]; actions: Snippet; onCreate: (a: Partial<Annotation>) => void } = $props();

  const ACTUAL = 96 / 72;
  const GAP = 12;
  const PAD = 16;

  let pdf = $state.raw<PdfDoc | null>(null);
  let error = $state("");
  let progress = $state(0);
  let sizes = $state<{ w: number; h: number }[]>([]);
  let scale = $state(ACTUAL);
  let pageNow = $state(1);
  let tool = $state<"select" | "area" | "note">("select");
  let popup = $state<{ x: number; y: number; page: number; rects: Rect[]; text: string } | null>(null);
  let scroller = $state<HTMLDivElement>();

  let searchOpen = $state(false);
  let query = $state("");
  let searching = $state("");
  let results = $state.raw<{ page: number; snippet: string }[] | null>(null);
  let pageTexts: string[] = [];

  let tops = $derived.by(() => {
    const out: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      out.push(y);
      y += s.h * scale + GAP;
    }
    return out;
  });
  let byPage = $derived.by(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annos) if (a.page) m.set(a.page, [...(m.get(a.page) ?? []), a]);
    return m;
  });
  const NONE: Annotation[] = [];

  // A tab never changes its file, so reading it once is intended.
  // svelte-ignore state_referenced_locally
  const task = openPdf(fileUrl(tab.provider, tab.path));
  task.onProgress = (p: { loaded: number; total: number }) => (progress = p.total ? p.loaded / p.total : 0);
  task.promise
    .then(async (doc) => {
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      sizes = Array.from({ length: doc.numPages }, () => ({ w: first.width, h: first.height }));
      pdf = doc;
      await tick();
      scale = tab.view?.scale ?? ACTUAL;
      await tick();
      if (tab.view?.page) goToPage(tab.view.page);
    })
    .catch((e) => (error = e?.message ?? "The PDF could not be opened"));
  onDestroy(() => void task.destroy());

  const fitScale = () => {
    const w = (scroller?.clientWidth ?? 800) - 2 * PAD - 12;
    return Math.min(2.5, Math.max(0.1, w / (sizes[pageNow - 1]?.w ?? 600)));
  };

  function onSize(n: number, s: { w: number; h: number }) {
    const cur = sizes[n - 1];
    if (cur && (Math.abs(cur.w - s.w) > 0.5 || Math.abs(cur.h - s.h) > 0.5)) sizes[n - 1] = s;
  }

  function goToPage(n: number, frac = 0) {
    const p = Math.min(Math.max(1, Math.round(n) || 1), sizes.length);
    if (scroller) scroller.scrollTop = tops[p - 1] - PAD / 2 + frac * sizes[p - 1].h * scale;
  }

  async function setScale(next: number) {
    if (!scroller) return;
    const i = pageNow - 1;
    const frac = (scroller.scrollTop - tops[i]) / (sizes[i].h * scale);
    scale = Math.min(5, Math.max(0.1, next));
    tab.view = { ...tab.view, scale };
    await tick();
    scroller.scrollTop = tops[i] + frac * sizes[i].h * scale;
  }

  let ticking = false;
  function onScroll() {
    popup = null;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!scroller) return;
      const y = scroller.scrollTop + scroller.clientHeight * 0.3;
      let lo = 0;
      let hi = tops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      if (pageNow !== lo + 1) {
        pageNow = lo + 1;
        tab.view = { ...tab.view, page: pageNow };
      }
    });
  }

  function zoomWheel(el: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      void setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }

  function onSelectionEnd() {
    if (tool !== "select") return;
    setTimeout(() => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !scroller) return void (popup = null);
      const range = sel.getRangeAt(0);
      const startNode = range.startContainer;
      const startEl = startNode instanceof Element ? startNode : startNode.parentElement;
      const pageEl = startEl?.closest<HTMLElement>(".page");
      if (!pageEl || !scroller.contains(pageEl)) return void (popup = null);
      const pr = pageEl.getBoundingClientRect();
      const raw = [...range.getClientRects()].filter(
        (r) => r.width > 1 && r.height > 1 && r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2 && r.height < pr.height * 0.2,
      );
      if (!raw.length) return void (popup = null);
      const rects = mergeLineRects(
        raw.map((r) => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height })),
      );
      const last = raw[raw.length - 1];
      const host = scroller.getBoundingClientRect();
      popup = {
        x: Math.min(Math.max(last.right - host.left - 80, 8), host.width - (qia.active ? 270 : 190)),
        y: Math.max(4, Math.min(last.bottom - host.top + 6, host.height - (qia.active ? 300 : 44))),
        page: Number(pageEl.dataset.page),
        rects,
        text: sel.toString().replace(/\s+/g, " ").trim().slice(0, 4000),
      };
    });
  }

  function highlight(color: string, category = "") {
    if (!popup) return;
    ws.pin(tab.id);
    onCreate({ kind: "highlight", page: popup.page, anchor: { rects: popup.rects }, quote: popup.text, color, category });
    getSelection()?.removeAllRanges();
    popup = null;
  }

  function reveal(a: Annotation) {
    if (!a.page || !sizes.length) return;
    const r = a.anchor?.rects?.[0];
    goToPage(a.page, Math.max(0, (r?.y ?? 0) - 0.12));
  }

  // Jump requests come from the annotation panel and the project page.
  $effect(() => {
    const id = tab.jump?.annoId;
    void tab.jump?.n;
    if (!id || !pdf) return;
    untrack(() => {
      const a = annos.find((x) => x.id === id);
      if (a) void tick().then(() => reveal(a));
    });
  });

  async function search(e: SubmitEvent) {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q || !pdf) return void (results = null);
    const found: { page: number; snippet: string }[] = [];
    for (let i = 1; i <= pdf.numPages && found.length < 300; i++) {
      if (pageTexts[i] === undefined) {
        searching = t("Reading page {i} of {n}", { i, n: pdf.numPages });
        const content = await (await pdf.getPage(i)).getTextContent();
        pageTexts[i] = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
      }
      const text = pageTexts[i];
      const lower = text.toLowerCase();
      let at = lower.indexOf(q);
      let perPage = 0;
      while (at >= 0 && perPage < 5) {
        found.push({ page: i, snippet: text.slice(Math.max(0, at - 40), at + q.length + 60) });
        at = lower.indexOf(q, at + q.length);
        perPage++;
      }
    }
    searching = "";
    results = found;
  }
</script>

<div class="viewer">
  <div class="toolbar">
    <div class="seg" role="group" aria-label={t("Annotation tool")}>
      <button class={["icon-btn", { on: tool === "select" }]} title={t("Select text to highlight it")} onclick={() => (tool = "select")}><Icon name="marker" /></button>
      <button class={["icon-btn", { on: tool === "area" }]} title={t("Draw an area (works on scans and drawings)")} onclick={() => (tool = "area")}><Icon name="area" /></button>
      <button class={["icon-btn", { on: tool === "note" }]} title={t("Place a note")} onclick={() => (tool = "note")}><Icon name="note" /></button>
    </div>
    <span class="sep"></span>
    <input
      class="pageno"
      type="text"
      inputmode="numeric"
      value={pageNow}
      aria-label={t("Page")}
      onchange={(e) => goToPage(Number(e.currentTarget.value))}
    />
    <span class="muted">/ {sizes.length || "–"}</span>
    <span class="sep"></span>
    <button class="icon-btn" title={t("Zoom out")} onclick={() => setScale(scale / 1.2)}><Icon name="minus" /></button>
    <button class="zoom" title={t("Reset zoom to 100%")} onclick={() => setScale(ACTUAL)}>{Math.round((scale / ACTUAL) * 100)}%</button>
    <button class="icon-btn" title={t("Zoom in")} onclick={() => setScale(scale * 1.2)}><Icon name="plus" /></button>
    <button class="icon-btn" title={t("Fit page width")} onclick={() => setScale(fitScale())}><Icon name="fit" /></button>
    <button class={["icon-btn", { on: searchOpen }]} title={t("Search in this document")} onclick={() => (searchOpen = !searchOpen)}><Icon name="search" /></button>
    <span class="grow"></span>
    {@render actions()}
  </div>

  {#if searchOpen}
    <div class="search">
      <form onsubmit={search}>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="search" placeholder={t("Search text, then press Enter")} bind:value={query} autofocus />
      </form>
      {#if searching}
        <p class="muted">{searching}…</p>
      {:else if results}
        <p class="muted">{results.length ? t("{n} matches", { n: `${results.length}${results.length >= 300 ? "+" : ""}` }) : t("No matches. Scanned pages have no searchable text.")}</p>
        <ul>
          {#each results as r, i (i)}
            <li><button onclick={() => goToPage(r.page)}><b>{t("p. {n}", { n: r.page })}</b> {r.snippet}</button></li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="stage">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="scroller" bind:this={scroller} onscroll={onScroll} onpointerup={onSelectionEnd} {@attach zoomWheel}>
      {#if error}
        <p class="state err">{t("This PDF could not be opened: {error}", { error })}</p>
      {:else if !pdf}
        <p class="state">{t("Loading document…")} {progress ? Math.round(progress * 100) + "%" : ""}</p>
      {:else}
        <div class="pages" style:padding="{PAD}px" style:gap="{GAP}px">
          {#each sizes as size, i (i)}
            <PdfPage
              {pdf}
              n={i + 1}
              {size}
              {scale}
              {tool}
              annos={byPage.get(i + 1) ?? NONE}
              {onSize}
              onCreate={(a) => {
                tool = "select";
                onCreate(a);
              }}
            />
          {/each}
        </div>
      {/if}
    </div>
    {#if popup}
      <div class={["popup", { cats: !!qia.active }]} style:left="{popup.x}px" style:top="{popup.y}px" onpointerdown={(e) => e.preventDefault()} role="toolbar" aria-label={t("Highlight colour")} tabindex="-1">
        {#if qia.active}
          <span class="ptitle ellipsis">{qia.active.name}</span>
          {#each qia.tree(qia.activeId) as { cat, depth } (cat.id)}
            <button class="pcat" style:padding-left="{8 + depth * 14}px" title={cat.definition || undefined} onclick={() => highlight("yellow", cat.id)}>
              <i style:background={cat.color}></i><span class="ellipsis">{cat.name}</span>
            </button>
          {/each}
          <button class="pcat plain" onclick={() => highlight("yellow")}>{t("Mark without category")}</button>
        {:else}
        <span>{t("Highlight")}</span>
        {#each Object.entries(COLORS) as [name, hex] (name)}
          <button class="swatch" style:background={hex} title={t(name)} aria-label={t(name)} onclick={() => highlight(name)}></button>
        {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .scroller {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--canvas);
  }
  .pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: min-content;
  }
  .state {
    margin: 15vh auto;
    text-align: center;
    color: var(--text-2);
  }
  .state.err {
    background: var(--paper);
    color: var(--danger);
    max-width: 420px;
    padding: 16px;
    border-radius: var(--radius);
  }
  .pageno {
    width: 46px;
    height: 24px;
    padding: 0 4px;
    text-align: right;
  }
  .zoom {
    height: 26px;
    border-radius: 5px;
    width: 44px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .popup {
    position: absolute;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: var(--asphalt);
    color: #fff;
    border-radius: 5px;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
    font-size: 12.5px;
  }
  .popup.cats {
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    width: 250px;
    max-height: 290px;
    overflow-y: auto;
    padding: 6px;
  }
  .ptitle {
    padding: 2px 8px 5px;
    font-size: 11.5px;
    opacity: 0.7;
  }
  .pcat {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding-right: 8px;
    border-radius: 4px;
    color: #fff;
    text-align: left;
    flex: none;
  }
  .pcat:hover {
    background: rgb(255 255 255 / 0.14);
  }
  .pcat i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }
  .pcat.plain {
    opacity: 0.75;
    padding-left: 8px;
    margin-top: 3px;
    border-top: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 0 0 4px 4px;
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid rgb(255 255 255 / 0.85);
  }
  .swatch:hover {
    transform: scale(1.15);
  }
  .search {
    border-bottom: 1px solid var(--line);
    background: var(--lane);
    padding: 8px 10px;
    max-height: 40%;
    overflow: auto;
    flex: none;
  }
  .search p {
    margin: 6px 0 2px;
    font-size: 12.5px;
  }
  .search ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .search li button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 3px 4px;
    font-family: var(--font-text);
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search li button:hover {
    background: var(--sign-soft);
  }
  .search b {
    font-family: var(--font);
    margin-right: 6px;
  }
</style>
