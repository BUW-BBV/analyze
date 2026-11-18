<script lang="ts">
  import { tick, untrack, type Snippet } from "svelte";
  import { api, type Annotation, type Sheet } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { annoColor } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";
  import type { Tab } from "../lib/workspace.svelte";
  import Icon from "./Icon.svelte";

  let {
    tab,
    annos,
    actions,
    onCreate,
  }: { tab: Tab; annos: Annotation[]; actions: Snippet; onCreate: (a: Partial<Annotation>) => void } = $props();

  const HEAD = 22;
  const GUTTER = 46;

  let sheets = $state.raw<Sheet[] | null>(null);
  let error = $state("");
  // A tab never changes its file, so reading it once is intended.
  // svelte-ignore state_referenced_locally
  let current = $state(tab.view?.sheet ?? 0);
  let sel = $state<{ r: number; c: number } | null>(null);
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let viewW = $state(800);
  let viewH = $state(600);
  let zoom = $state(1);
  let scroller = $state<HTMLDivElement>();

  // svelte-ignore state_referenced_locally
  api
    .sheet(tab.provider, tab.path)
    .then((s) => {
      sheets = s;
      if (current >= s.length) current = 0;
    })
    .catch((e) => (error = e.message));

  let sheet = $derived(sheets?.[current]);

  const prefix = (sizes: number[]) => {
    const out = [0];
    for (const s of sizes) out.push(out[out.length - 1] + s);
    return out;
  };
  let lefts = $derived(prefix(sheet?.colWidths ?? []));
  let tops = $derived(prefix(sheet?.rowHeights ?? []));
  let totalW = $derived(lefts[lefts.length - 1]);
  let totalH = $derived(tops[tops.length - 1]);

  /** Index of the row or column that contains the offset. */
  function at(offsets: number[], pos: number): number {
    let lo = 0;
    let hi = offsets.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  let rowRange = $derived({
    first: Math.max(0, at(tops, scrollTop / zoom) - 3),
    last: Math.min((sheet?.rows ?? 1) - 1, at(tops, (scrollTop + viewH) / zoom) + 3),
  });
  let colRange = $derived({
    first: Math.max(0, at(lefts, scrollLeft / zoom) - 2),
    last: Math.min((sheet?.cols ?? 1) - 1, at(lefts, (scrollLeft + viewW) / zoom) + 2),
  });

  let merged = $derived.by(() => {
    const anchors = new Map<string, { rs: number; cs: number }>();
    const covered = new Set<string>();
    for (const m of sheet?.merges ?? []) {
      anchors.set(`${m.r},${m.c}`, m);
      for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) if (r !== m.r || c !== m.c) covered.add(`${r},${c}`);
    }
    return { anchors, covered };
  });

  let marks = $derived.by(() => {
    const m = new Map<string, Annotation>();
    for (const a of annos) if (a.kind === "cell" && a.anchor?.sheet === sheet?.name) m.set(`${a.anchor?.r},${a.anchor?.c}`, a);
    return m;
  });

  type Cell = { key: string; r: number; c: number; x: number; y: number; w: number; h: number; text: string; style: string; merged: boolean };
  let cells = $derived.by(() => {
    if (!sheet) return [];
    const out: Cell[] = [];
    const add = (r: number, c: number) => {
      const key = `${r},${c}`;
      const text = sheet.cells[r]?.[c] ?? "";
      const style = sheet.styles[sheet.styleIdx[r]?.[c] ?? 0] ?? "";
      const m = merged.anchors.get(key);
      if (!text && !style && !m && !marks.has(key) && !(sel?.r === r && sel.c === c)) return;
      const w = lefts[Math.min(c + (m?.cs ?? 1), sheet.cols)] - lefts[c];
      const h = tops[Math.min(r + (m?.rs ?? 1), sheet.rows)] - tops[r];
      if (w <= 0 || h <= 0) return;
      out.push({ key, r, c, x: lefts[c], y: tops[r], w, h, text, style, merged: !!m });
    };
    for (let r = rowRange.first; r <= rowRange.last; r++) {
      for (let c = colRange.first; c <= colRange.last; c++) if (!merged.covered.has(`${r},${c}`)) add(r, c);
    }
    // merged cells that start outside the visible window but reach into it
    for (const m of sheet.merges) {
      const inWindow = m.r >= rowRange.first && m.r <= rowRange.last && m.c >= colRange.first && m.c <= colRange.last;
      const reaches = m.r <= rowRange.last && m.r + m.rs > rowRange.first && m.c <= colRange.last && m.c + m.cs > colRange.first;
      if (!inWindow && reaches) add(m.r, m.c);
    }
    return out;
  });

  const span = (first: number, last: number) => Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
  let visRows = $derived(span(rowRange.first, rowRange.last));
  let visCols = $derived(span(colRange.first, colRange.last));

  const colName = (c: number) => {
    let s = "";
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const refOf = (r: number, c: number) => `${colName(c)}${r + 1}`;
  const isNumber = (text: string) => /^[-+(]?[\d.,\s]+[)%€]?$/.test(text) && /\d/.test(text);

  function pickCell(e: MouseEvent) {
    if (!sheet || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const x = (e.clientX - box.left + scroller.scrollLeft - GUTTER) / zoom;
    const y = (e.clientY - box.top + scroller.scrollTop - HEAD) / zoom;
    if (x < 0 || y < 0 || x >= totalW || y >= totalH) return;
    let r = at(tops, y);
    let c = at(lefts, x);
    for (const m of sheet.merges) if (r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs) [r, c] = [m.r, m.c];
    sel = { r, c };
    const a = marks.get(`${r},${c}`);
    if (a) app.focusedAnno = a.id;
  }

  function annotate() {
    if (!sel || !sheet) return;
    const existing = marks.get(`${sel.r},${sel.c}`);
    if (existing) return void (app.focusedAnno = existing.id);
    onCreate({
      kind: "cell",
      anchor: { sheet: sheet.name, ref: refOf(sel.r, sel.c), r: sel.r, c: sel.c },
      quote: (sheet.cells[sel.r]?.[sel.c] ?? "").slice(0, 2000),
    });
  }

  function switchSheet(i: number) {
    current = i;
    sel = null;
    tab.view = { ...tab.view, sheet: i };
    if (scroller) scroller.scrollTop = scroller.scrollLeft = 0;
  }

  const setZoom = (z: number) => (zoom = Math.min(2.5, Math.max(0.4, Math.round(z * 10) / 10)));

  $effect(() => {
    const id = tab.jump?.annoId;
    void tab.jump?.n;
    if (!id || !sheets) return;
    untrack(() => {
      const a = annos.find((x) => x.id === id);
      if (a?.kind !== "cell" || !a.anchor) return;
      const i = sheets!.findIndex((s) => s.name === a.anchor!.sheet);
      if (i < 0) return;
      current = i;
      sel = { r: a.anchor.r!, c: a.anchor.c! };
      void tick().then(() => {
        if (!scroller) return;
        scroller.scrollTop = Math.max(0, tops[a.anchor!.r!] * zoom - viewH / 3);
        scroller.scrollLeft = Math.max(0, lefts[a.anchor!.c!] * zoom - viewW / 3);
      });
    });
  });
</script>

<div class="viewer">
  <div class="toolbar">
    <span class="ref">{sel ? refOf(sel.r, sel.c) : ""}</span>
    <span class="value" title={sel && sheet ? sheet.cells[sel.r]?.[sel.c] : ""}>
      {#if sel && sheet}{sheet.cells[sel.r]?.[sel.c] ?? ""}{:else}<span class="muted">{t("Select a cell to read its full content or annotate it")}</span>{/if}
    </span>
    <button class="btn" disabled={!sel} onclick={annotate}><Icon name="note" size={13} /> {t("Annotate cell")}</button>
    <span class="sep"></span>
    <button class="icon-btn" title={t("Zoom out")} onclick={() => setZoom(zoom - 0.1)}><Icon name="minus" /></button>
    <button class="zoom" title={t("Reset zoom")} onclick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
    <button class="icon-btn" title={t("Zoom in")} onclick={() => setZoom(zoom + 0.1)}><Icon name="plus" /></button>
    <span class="sep"></span>
    {@render actions()}
  </div>

  {#if error}
    <p class="state err">{t("This spreadsheet could not be read: {error}", { error })}</p>
  {:else if !sheet}
    <p class="state">{t("Reading spreadsheet…")}</p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="scroller"
      bind:this={scroller}
      bind:clientWidth={viewW}
      bind:clientHeight={viewH}
      onscroll={(e) => {
        scrollTop = e.currentTarget.scrollTop;
        scrollLeft = e.currentTarget.scrollLeft;
      }}
      onclick={pickCell}
    >
      <div class="inner" style:width="{GUTTER + totalW * zoom}px" style:height="{HEAD + totalH * zoom}px">
        <div class="colhead" style:height="{HEAD}px">
          <div class="corner" style:width="{GUTTER}px" style:height="{HEAD}px"></div>
          {#each visCols as c (c)}
            {#if sheet.colWidths[c] > 0}
              <span class={["h", { on: sel?.c === c }]} style="left:{GUTTER + lefts[c] * zoom}px;width:{sheet.colWidths[c] * zoom}px">{colName(c)}</span>
            {/if}
          {/each}
        </div>
        <div class="rowhead" style:width="{GUTTER}px" style:height="{totalH * zoom}px">
          {#each visRows as r (r)}
            {#if sheet.rowHeights[r] > 0}
              <span class={["h", { on: sel?.r === r }]} style="top:{tops[r] * zoom}px;height:{sheet.rowHeights[r] * zoom}px">{r + 1}</span>
            {/if}
          {/each}
        </div>
        <!-- The sheet itself always renders on white, like the PDF pages, so cell colours stay true. -->
        <div class="cells" style:left="{GUTTER}px" style:top="{HEAD}px" style:width="{totalW}px" style:height="{totalH}px" style:zoom>
          {#each visRows as r (r)}<i class="gl row" style:top="{tops[r + 1] - 1}px"></i>{/each}
          {#each visCols as c (c)}<i class="gl col" style:left="{lefts[c + 1] - 1}px"></i>{/each}
          {#each cells as cell (cell.key)}
            {@const mark = marks.get(cell.key)}
            <div
              class={["cell", { num: isNumber(cell.text), merged: cell.merged, sel: sel?.r === cell.r && sel.c === cell.c, marked: !!mark, focus: mark && app.focusedAnno === mark.id }]}
              style="left:{cell.x}px;top:{cell.y}px;width:{cell.w}px;height:{cell.h}px;{cell.style}{mark ? `;--c:${annoColor(mark)}` : ''}"
            >
              <span>{cell.text}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
    <div class="sheets" role="tablist">
      {#each sheets ?? [] as s, i (s.name)}
        <button role="tab" aria-selected={i === current} class={{ on: i === current }} onclick={() => switchSheet(i)}>{s.name}</button>
      {/each}
      <span class="dims muted">{t("{rows} rows, {cols} columns", { rows: sheet.rows, cols: sheet.cols })}</span>
    </div>
  {/if}
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--surface);
  }
  .ref {
    width: 54px;
    font-weight: 600;
    text-align: center;
    color: var(--text);
  }
  .value {
    flex: 1;
    min-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 8px;
    border-left: 1px solid var(--border);
    color: var(--text);
  }
  .zoom {
    width: 44px;
    height: 26px;
    border-radius: 5px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .zoom:hover {
    background: var(--surface-3);
  }
  .state {
    margin: 15vh auto;
    color: var(--text-2);
  }
  .err {
    color: var(--danger);
  }
  .scroller {
    flex: 1;
    overflow: auto;
    min-height: 0;
    background: var(--canvas);
  }
  .inner {
    position: relative;
  }
  .colhead {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-strong);
  }
  .corner {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--surface-2);
    border-right: 1px solid var(--border-strong);
  }
  .rowhead {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--surface-2);
    border-right: 1px solid var(--border-strong);
  }
  .h {
    position: absolute;
    display: grid;
    place-items: center;
    color: var(--text-2);
    font-size: 11.5px;
    overflow: hidden;
  }
  .colhead .h {
    top: 0;
    height: 100%;
    border-right: 1px solid var(--border);
  }
  .rowhead .h {
    left: 0;
    width: 100%;
    border-bottom: 1px solid var(--border);
  }
  .h.on {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
  .cells {
    position: absolute;
    background: #fff;
    color: #000;
    font: 11pt Calibri, "Segoe UI", sans-serif;
    color-scheme: only light;
    overflow: hidden;
  }
  .gl {
    position: absolute;
    background: #e1e1e1;
  }
  .gl.row {
    left: 0;
    right: 0;
    height: 1px;
  }
  .gl.col {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  /* Excel defaults: text bottom-left, numbers bottom-right, no wrapping. The cell's own style comes after. */
  .cell {
    position: absolute;
    display: flex;
    align-items: flex-end;
    padding: 1px 3px;
    overflow: hidden;
    white-space: nowrap;
    line-height: 1.2;
    cursor: cell;
  }
  .cell span {
    min-width: 0;
    max-height: 100%;
  }
  .cell.num {
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
  }
  .cell.merged {
    background: #fff;
  }
  .cell.marked {
    box-shadow: inset 0 0 0 2px var(--c);
  }
  .cell.marked::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    border: 5px solid var(--c);
    border-left-color: transparent;
    border-bottom-color: transparent;
  }
  .cell.sel,
  .cell.focus {
    outline: 2px solid #1d54b4;
    outline-offset: -1px;
    z-index: 1;
  }
  .sheets {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    height: 30px;
    padding: 0 8px;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .sheets button {
    height: 30px;
    padding: 0 12px;
    white-space: nowrap;
    color: var(--text-2);
  }
  .sheets button.on {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .dims {
    margin-left: auto;
    padding-left: 12px;
    font-size: 12px;
    white-space: nowrap;
  }
</style>
