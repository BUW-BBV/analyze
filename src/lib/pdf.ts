import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Rect } from "./api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type PdfDoc = pdfjs.PDFDocumentProxy;

export function openPdf(url: string) {
  return pdfjs.getDocument({
    url,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  });
}

/** Merge the many small client rects of a text selection into one rect per line. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Rect[] = [];
  for (const r of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.y + l.h, r.y + r.h) - Math.max(l.y, r.y);
      return overlap > 0.5 * Math.min(l.h, r.h);
    });
    if (!line) {
      lines.push({ ...r });
      continue;
    }
    const x2 = Math.max(line.x + line.w, r.x + r.w);
    const y2 = Math.max(line.y + line.h, r.y + r.h);
    line.x = Math.min(line.x, r.x);
    line.y = Math.min(line.y, r.y);
    line.w = x2 - line.x;
    line.h = y2 - line.y;
  }
  return lines.map((l) => ({ x: +l.x.toFixed(5), y: +l.y.toFixed(5), w: +l.w.toFixed(5), h: +l.h.toFixed(5) }));
}
