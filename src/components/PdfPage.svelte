<script lang="ts">
  import type { Annotation, Rect } from "../lib/api";
  import { pdfjs, type PdfDoc } from "../lib/pdf";
  import { annoColor } from "../lib/qia.svelte";
  import { app } from "../lib/state.svelte";

  type Tool = "select" | "area" | "note";
  let {
    pdf,
    n,
    size,
    scale,
    annos,
    tool,
    onSize,
    onCreate,
  }: {
    pdf: PdfDoc;
    n: number;
    size: { w: number; h: number };
    scale: number;
    annos: Annotation[];
    tool: Tool;
    onSize: (n: number, size: { w: number; h: number }) => void;
    onCreate: (a: Partial<Annotation>) => void;
  } = $props();

  let visible = $state(false);
  let failed = $state("");
  let draft = $state<Rect | null>(null);
  let canvas: HTMLCanvasElement;
  let textEl: HTMLDivElement;
  let pageEl: HTMLDivElement;

  function observe(el: HTMLElement) {
    const io = new IntersectionObserver((entries) => (visible = entries[entries.length - 1].isIntersecting), {
      root: el.closest(".scroller"),
      rootMargin: "700px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }

  // Keep the canvas and text layer in sync with visibility and zoom.
  $effect(() => {
    if (!visible) {
      canvas.width = canvas.height = 0;
      textEl.replaceChildren();
      return;
    }
    const s = scale;
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    (async () => {
      const page = await pdf.getPage(n);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      onSize(n, { w: base.width, h: base.height });
      let out = s * (window.devicePixelRatio || 1);
      const pixels = base.width * base.height * out * out;
      if (pixels > 14e6) out *= Math.sqrt(14e6 / pixels); // large plan sheets
      const vp = page.getViewport({ scale: out });
      const buffer = document.createElement("canvas");
      buffer.width = Math.floor(vp.width);
      buffer.height = Math.floor(vp.height);
      task = page.render({ canvas: buffer, canvasContext: buffer.getContext("2d")!, viewport: vp });
      await task.promise;
      if (cancelled) return;
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.getContext("2d")!.drawImage(buffer, 0, 0);
      failed = "";
      const layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textEl,
        viewport: page.getViewport({ scale: s }),
      });
      textEl.replaceChildren();
      await layer.render();
    })().catch((e) => {
      if (!cancelled && e?.name !== "RenderingCancelledException") failed = e?.message ?? "Rendering failed";
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  });

  const pos = (e: PointerEvent | MouseEvent) => {
    const r = pageEl.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  function pick(e: MouseEvent) {
    if (tool !== "select" || !getSelection()?.isCollapsed) return;
    const p = pos(e);
    const padX = 6 / (size.w * scale);
    const padY = 6 / (size.h * scale);
    const hit = [...annos].reverse().find((a) =>
      (a.anchor?.rects ?? []).some((r) => {
        const px = a.kind === "note" ? padX * 3 : padX * 0.3;
        const py = a.kind === "note" ? padY * 3 : padY * 0.3;
        return p.x >= r.x - px && p.x <= r.x + r.w + px && p.y >= r.y - py && p.y <= r.y + r.h + py;
      }),
    );
    if (hit) app.focusedAnno = hit.id;
  }

  function textInside(rect: Rect): string {
    const pr = pageEl.getBoundingClientRect();
    const parts: string[] = [];
    for (const span of textEl.querySelectorAll("span")) {
      const r = span.getBoundingClientRect();
      const cx = (r.left + r.width / 2 - pr.left) / pr.width;
      const cy = (r.top + r.height / 2 - pr.top) / pr.height;
      if (cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h) parts.push(span.textContent ?? "");
    }
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 2000);
  }

  function draw(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const start = pos(e);
    if (tool === "note") {
      onCreate({ kind: "note", page: n, anchor: { rects: [{ x: start.x, y: start.y, w: 0, h: 0 }] } });
      return;
    }
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = pos(ev);
      draft = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      const r = draft;
      draft = null;
      if (r && r.w * size.w * scale > 6 && r.h * size.h * scale > 6) {
        const rect = { x: +r.x.toFixed(5), y: +r.y.toFixed(5), w: +r.w.toFixed(5), h: +r.h.toFixed(5) };
        onCreate({ kind: "area", page: n, anchor: { rects: [rect] }, quote: textInside(rect) });
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
  }

  const rectStyle = (r: Rect) => `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="page"
  bind:this={pageEl}
  data-page={n}
  style:width="{size.w * scale}px"
  style:height="{size.h * scale}px"
  style:--total-scale-factor={scale}
  onclick={pick}
  {@attach observe}
>
  <canvas bind:this={canvas}></canvas>
  <div class="marks">
    {#each annos as a (a.id)}
      {@const color = annoColor(a)}
      {#each a.anchor?.rects ?? [] as r, i (i)}
        {#if a.kind === "note"}
          <span class={["pin", { sel: app.focusedAnno === a.id }]} style="left:{r.x * 100}%;top:{r.y * 100}%;--c:{color}"></span>
        {:else}
          <span class={[a.kind, { sel: app.focusedAnno === a.id }]} style="{rectStyle(r)};--c:{color}"></span>
        {/if}
      {/each}
    {/each}
  </div>
  <div class="textLayer" bind:this={textEl}></div>
  {#if tool !== "select"}
    <div class="draw" onpointerdown={draw}>
      {#if draft}<span class="area draft" style={rectStyle(draft)}></span>{/if}
    </div>
  {/if}
  {#if failed}<p class="failed">Page {n} could not be rendered: {failed}</p>{/if}
</div>

<style>
  .page {
    position: relative;
    background: #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
    flex: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .marks,
  .draw {
    position: absolute;
    inset: 0;
  }
  .marks {
    z-index: 1;
    pointer-events: none;
  }
  .draw {
    z-index: 5;
    cursor: crosshair;
    touch-action: none;
  }
  .marks span,
  .draft {
    position: absolute;
    --c: var(--yellow);
  }
  .highlight {
    background: color-mix(in srgb, var(--c) 42%, transparent);
    mix-blend-mode: multiply;
    border-radius: 2px;
  }
  .area {
    border: 2px solid var(--c);
    background: color-mix(in srgb, var(--c) 12%, transparent);
  }
  .draft {
    border-style: dashed;
    border-color: var(--sign);
  }
  .pin {
    width: 20px;
    height: 20px;
    margin: -20px 0 0 0;
    background: var(--c);
    border: 1.5px solid #1b2026;
    border-radius: 3px 3px 3px 0;
  }
  .sel {
    outline: 2px solid var(--sign);
    outline-offset: 2px;
  }
  .failed {
    position: absolute;
    inset: 40% 10% auto;
    text-align: center;
    color: var(--danger);
  }
</style>
