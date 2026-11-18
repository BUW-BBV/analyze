// Spreadsheet parsing. SheetJS provides the displayed text of every cell (number
// formats applied); ExcelJS adds fonts, fills, borders, alignment and row/column sizes.
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

export type SheetOut = {
  name: string;
  rows: number;
  cols: number;
  cells: string[][];
  merges: { r: number; c: number; rs: number; cs: number }[];
  colWidths: number[];
  rowHeights: number[];
  styles: string[]; // CSS declarations, index 0 is "no style"
  styleIdx: number[][]; // per cell: index into styles
};

const MAX_ROWS = 50000;
const MAX_COLS = 500;
const DEFAULT_ROW = 20;
const DEFAULT_COL = 64;

const THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
const INDEXED =
  "000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,800000,008000,000080,808000,800080,008080,C0C0C0,808080,9999FF,993366,FFFFCC,CCFFFF,660066,FF8080,0066CC,CCCCFF,000080,FF00FF,FFFF00,00FFFF,800080,800000,008080,0000FF,00CCFF,CCFFFF,CCFFCC,FFFF99,99CCFF,FF99CC,CC99FF,FFCC99,3366FF,33CCCC,99CC00,FFCC00,FF9900,FF6600,666699,969696,003366,339966,003300,333300,993300,993366,333399,333333".split(
    ",",
  );

function tinted(hex: string, tint: number): string {
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((v) => Math.round(tint < 0 ? v * (1 + tint) : v + (255 - v) * tint));
  return out.map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0")).join("");
}

function css(color: any): string | null {
  if (!color) return null;
  if (typeof color.argb === "string" && color.argb.length >= 6) {
    const a = color.argb.length === 8 ? color.argb.slice(0, 2) : "FF";
    if (a === "00" && color.argb.slice(2) === "000000") return null;
    return `#${color.argb.slice(-6)}`;
  }
  if (typeof color.theme === "number" && THEME[color.theme]) return `#${tinted(THEME[color.theme], color.tint ?? 0)}`;
  if (typeof color.indexed === "number" && INDEXED[color.indexed]) return `#${INDEXED[color.indexed]}`;
  return null;
}

const BORDER: Record<string, string> = {
  thin: "1px solid",
  hair: "1px dotted",
  dotted: "1px dotted",
  dashed: "1px dashed",
  dashDot: "1px dashed",
  dashDotDot: "1px dashed",
  mediumDashed: "2px dashed",
  mediumDashDot: "2px dashed",
  mediumDashDotDot: "2px dashed",
  slantDashDot: "2px dashed",
  medium: "2px solid",
  thick: "3px solid",
  double: "3px double",
};

function styleOf(cell: ExcelJS.Cell): string {
  const s: string[] = [];
  const f = cell.font;
  if (f) {
    if (f.bold) s.push("font-weight:700");
    if (f.italic) s.push("font-style:italic");
    const deco = [f.underline ? "underline" : "", f.strike ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) s.push(`text-decoration:${deco}`);
    if (f.size && f.size !== 11) s.push(`font-size:${f.size}pt`);
    if (f.name && f.name !== "Calibri") s.push(`font-family:'${f.name.replace(/['\\;]/g, "")}',Calibri,sans-serif`);
    const c = css(f.color);
    if (c && c !== "#000000") s.push(`color:${c}`);
  }
  const fill = cell.fill as any;
  if (fill?.type === "pattern" && fill.pattern && fill.pattern !== "none") {
    const c = css(fill.pattern === "solid" ? fill.fgColor : (fill.bgColor ?? fill.fgColor));
    if (c) s.push(`background:${c}`);
  } else if (fill?.type === "gradient" && fill.stops?.length) {
    const c = css(fill.stops[0].color);
    if (c) s.push(`background:${c}`);
  }
  const b = cell.border as any;
  if (b) {
    for (const side of ["top", "right", "bottom", "left"]) {
      const line = b[side];
      if (line?.style && BORDER[line.style]) s.push(`border-${side}:${BORDER[line.style]} ${css(line.color) ?? "#000"}`);
    }
  }
  const a = cell.alignment;
  if (a) {
    if (a.horizontal === "center" || a.horizontal === "centerContinuous") s.push("justify-content:center;text-align:center");
    else if (a.horizontal === "right") s.push("justify-content:flex-end;text-align:right");
    else if (a.horizontal === "left" || a.horizontal === "justify") s.push("justify-content:flex-start;text-align:left");
    if (a.vertical === "middle") s.push("align-items:center");
    else if (a.vertical === "top") s.push("align-items:flex-start");
    if (a.wrapText) s.push("white-space:pre-wrap;overflow-wrap:anywhere");
    if (a.textRotation === "vertical" || (typeof a.textRotation === "number" && Math.abs(a.textRotation) === 90))
      s.push("writing-mode:vertical-rl" + (a.textRotation === 90 ? ";transform:rotate(180deg)" : ""));
    if (a.indent) s.push(`padding-left:${3 + a.indent * 9}px`);
  }
  return s.join(";");
}

const cache = new Map<string, SheetOut[]>();

export async function parseWorkbook(key: string, bytes: Uint8Array, name: string): Promise<SheetOut[]> {
  const hit = cache.get(key);
  if (hit) return hit;

  const wb = XLSX.read(bytes, { cellDates: true, cellStyles: true, dateNF: "dd.mm.yyyy" });
  const sheets: SheetOut[] = wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const rows = Math.min(range.e.r + 1, MAX_ROWS);
    const cols = Math.min(range.e.c + 1, MAX_COLS);
    const cells: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < cols; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v == null) continue;
        row[c] = cell.w ?? (cell.v instanceof Date ? cell.v.toLocaleDateString("de-DE") : String(cell.v));
      }
      for (let c = 0; c < row.length; c++) row[c] ??= "";
      cells.push(row);
    }
    const merges = (ws["!merges"] ?? [])
      .filter((m) => m.s.r < rows && m.s.c < cols)
      .map((m) => ({ r: m.s.r, c: m.s.c, rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 }));
    const colWidths: number[] = [];
    for (let c = 0; c < cols; c++) {
      const info = ws["!cols"]?.[c];
      colWidths.push(info?.hidden ? 0 : Math.round(Math.min(Math.max(info?.wpx ?? (info?.wch ? info.wch * 7 + 5 : DEFAULT_COL), 12), 600)));
    }
    return { name: sheetName, rows, cols, cells, merges, colWidths, rowHeights: [], styles: [""], styleIdx: [] };
  });

  // Formatting (xlsx / xlsm only). Anything ExcelJS cannot read keeps the plain grid.
  if (/\.xls[xm]$/i.test(name)) {
    try {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      for (const sheet of sheets) {
        const ws = book.getWorksheet(sheet.name);
        if (!ws) continue;
        const index = new Map<string, number>([["", 0]]);
        // The styled area can be larger than the area that holds values.
        sheet.rows = Math.min(Math.max(sheet.rows, ws.rowCount), MAX_ROWS);
        sheet.cols = Math.min(Math.max(sheet.cols, ws.columnCount), MAX_COLS);
        const defRow = ws.properties?.defaultRowHeight ? Math.round((ws.properties.defaultRowHeight * 4) / 3) : DEFAULT_ROW;
        for (let c = sheet.colWidths.length; c < sheet.cols; c++) sheet.colWidths.push(DEFAULT_COL);
        for (let c = 0; c < sheet.cols; c++) {
          const col = ws.getColumn(c + 1);
          if (col.hidden) sheet.colWidths[c] = 0;
          else if (col.width) sheet.colWidths[c] = Math.round(Math.min(col.width * 7 + 5, 600));
        }
        sheet.rowHeights = Array.from({ length: sheet.rows }, () => defRow);
        ws.eachRow({ includeEmpty: false }, (row, n) => {
          const r = n - 1;
          if (r >= sheet.rows) return;
          if (row.hidden) sheet.rowHeights[r] = 0;
          else if (row.height) sheet.rowHeights[r] = Math.round((row.height * 4) / 3);
          const idx: number[] = [];
          row.eachCell({ includeEmpty: true }, (cell, cn) => {
            if (cn > sheet.cols || cell.isMerged && cell.master !== cell) return;
            const st = styleOf(cell);
            if (!st) return;
            let i = index.get(st);
            if (i === undefined) {
              i = sheet.styles.length;
              sheet.styles.push(st);
              index.set(st, i);
            }
            idx[cn - 1] = i;
          });
          for (let c = 0; c < idx.length; c++) idx[c] ??= 0;
          sheet.styleIdx[r] = idx;
        });
        for (let r = 0; r < sheet.rows; r++) sheet.styleIdx[r] ??= [];
      }
    } catch (e) {
      console.warn(`No formatting for ${name}: ${(e as Error).message}`);
    }
  }
  for (const sheet of sheets) {
    if (!sheet.rowHeights.length) sheet.rowHeights = Array.from({ length: sheet.rows }, () => DEFAULT_ROW);
  }

  cache.set(key, sheets);
  if (cache.size > 6) cache.delete(cache.keys().next().value!);
  return sheets;
}
