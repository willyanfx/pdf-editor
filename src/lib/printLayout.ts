import { PDFDocument, degrees, grayscale, type PDFEmbeddedPage } from "pdf-lib";
import { loadPdfLibDocument } from "./pdfLoad";

/** Paper sizes a layout can be printed on, in PDF points, portrait. */
export const SHEET_SIZES = {
  letter: { label: "Letter (8.5 × 11 in)", width: 612, height: 792 },
  a4: { label: "A4 (210 × 297 mm)", width: 595.28, height: 841.89 },
  legal: { label: "Legal (8.5 × 14 in)", width: 612, height: 1008 },
  a3: { label: "A3 (297 × 420 mm)", width: 841.89, height: 1190.55 },
  tabloid: { label: "Tabloid (11 × 17 in)", width: 792, height: 1224 },
} as const;

export type SheetSize = keyof typeof SHEET_SIZES;

export const PAGES_PER_SHEET = [2, 4, 6, 9, 16] as const;
export type PagesPerSheet = (typeof PAGES_PER_SHEET)[number];

/** Several source pages shrunk onto each sheet, like a printer's "pages per sheet". */
export type NUpOptions = {
  kind: "nup";
  perSheet: PagesPerSheet;
  sheet: SheetSize;
  /** "auto" picks whichever orientation lets the pages print largest. */
  orientation: "auto" | "portrait" | "landscape";
  /** Reading order across the sheet: left to right then down, or down then across. */
  order: "rows" | "columns";
  /** Space around the sheet edge and between pages, in points. */
  margin: number;
  /** Draw a thin outline around each page. */
  border: boolean;
};

/** Saddle-stitch imposition: print double-sided, fold the stack in half. */
export type BookletOptions = {
  kind: "booklet";
  sheet: SheetSize;
  /** Right-to-left binding (the spine on the right edge). */
  rightToLeft: boolean;
  margin: number;
  border: boolean;
};

export type LayoutOptions = NUpOptions | BookletOptions;

export const DEFAULT_NUP: NUpOptions = {
  kind: "nup",
  perSheet: 2,
  sheet: "letter",
  orientation: "auto",
  order: "rows",
  margin: 18,
  border: true,
};

export const DEFAULT_BOOKLET: BookletOptions = {
  kind: "booklet",
  sheet: "letter",
  rightToLeft: false,
  margin: 18,
  border: false,
};

/** Page size as displayed (after /Rotate), in points. */
export type PageSize = { width: number; height: number };

/** A rectangle on a sheet in PDF coordinates (origin bottom-left). */
export type Slot = { x: number; y: number; width: number; height: number };

/** One output page: its size and which source page (if any) goes in each slot. */
export type SheetPlan = {
  width: number;
  height: number;
  /** `src` is an index into the input pages, or null for a blank (padding) slot. */
  slots: (Slot & { src: number | null })[];
};

/** Gap between pages in an N-up grid, in points. */
const GRID_GAP = 8;

/** Columns × rows for `perSheet` pages; the longer side runs along the longer sheet edge. */
export function gridFor(
  perSheet: PagesPerSheet,
  landscape: boolean,
): { cols: number; rows: number } {
  const [long, short] = {
    2: [2, 1],
    4: [2, 2],
    6: [3, 2],
    9: [3, 3],
    16: [4, 4],
  }[perSheet];
  return landscape ? { cols: long, rows: short } : { cols: short, rows: long };
}

function sheetDimensions(sheet: SheetSize, landscape: boolean): PageSize {
  const { width, height } = SHEET_SIZES[sheet];
  return landscape ? { width: height, height: width } : { width, height };
}

/** Largest scale at which a `page` fits a slot of `cellW` × `cellH`. */
function fitScale(page: PageSize, cellW: number, cellH: number): number {
  return Math.min(cellW / page.width, cellH / page.height);
}

function gridSlots(
  sheet: PageSize,
  { cols, rows }: { cols: number; rows: number },
  margin: number,
  gap: number,
): Slot[] {
  const cellW = (sheet.width - 2 * margin - (cols - 1) * gap) / cols;
  const cellH = (sheet.height - 2 * margin - (rows - 1) * gap) / rows;
  const slots: Slot[] = [];
  // Row 0 is the TOP row; PDF y grows upward.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        x: margin + c * (cellW + gap),
        y: sheet.height - margin - (r + 1) * cellH - r * gap,
        width: cellW,
        height: cellH,
      });
    }
  }
  return slots;
}

/** Pick portrait or landscape for an N-up sheet: the one that prints the pages largest. */
function chooseLandscape(pages: PageSize[], options: NUpOptions): boolean {
  if (options.orientation !== "auto") return options.orientation === "landscape";
  // Judge by the first page, like a printer driver; mixed sizes still each fit their slot.
  const probe = pages[0] ?? { width: 612, height: 792 };
  const scaleFor = (landscape: boolean) => {
    const sheet = sheetDimensions(options.sheet, landscape);
    const [slot] = gridSlots(sheet, gridFor(options.perSheet, landscape), options.margin, GRID_GAP);
    return fitScale(probe, slot.width, slot.height);
  };
  const portrait = scaleFor(false);
  const landscape = scaleFor(true);
  if (portrait === landscape) return probe.width > probe.height;
  return landscape > portrait;
}

/** Slot order within a grid: row-major (as `gridSlots` builds it) or column-major. */
function orderSlots(slots: Slot[], cols: number, rows: number, order: "rows" | "columns"): Slot[] {
  if (order === "rows") return slots;
  const out: Slot[] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.push(slots[r * cols + c]);
  return out;
}

/** Layout for printing `pages.length` pages several to a sheet. */
export function planNUp(pages: PageSize[], options: NUpOptions): SheetPlan[] {
  const landscape = chooseLandscape(pages, options);
  const sheet = sheetDimensions(options.sheet, landscape);
  const grid = gridFor(options.perSheet, landscape);
  const slots = orderSlots(
    gridSlots(sheet, grid, options.margin, GRID_GAP),
    grid.cols,
    grid.rows,
    options.order,
  );
  const plans: SheetPlan[] = [];
  for (let start = 0; start < pages.length; start += options.perSheet) {
    plans.push({
      ...sheet,
      slots: slots.flatMap((slot, i) =>
        start + i < pages.length ? [{ ...slot, src: start + i }] : [],
      ),
    });
  }
  return plans;
}

/**
 * Page order for a saddle-stitched booklet of `count` pages: a list of
 * [left, right] source indices per printed side (front, back, front, back…),
 * with `null` marking blank pages added to reach a multiple of four.
 * Printed double-sided and folded, the pages read in order.
 */
export function bookletSides(
  count: number,
  rightToLeft: boolean,
): [number | null, number | null][] {
  const total = Math.ceil(count / 4) * 4;
  const page = (i: number) => (i < count ? i : null);
  const sides: [number | null, number | null][] = [];
  for (let sheet = 0; sheet < total / 4; sheet++) {
    // Outermost sheet carries the first and last pages; each sheet moves inward by two.
    const front: [number | null, number | null] = [page(total - 1 - 2 * sheet), page(2 * sheet)];
    const back: [number | null, number | null] = [page(2 * sheet + 1), page(total - 2 - 2 * sheet)];
    sides.push(rightToLeft ? [front[1], front[0]] : front);
    sides.push(rightToLeft ? [back[1], back[0]] : back);
  }
  return sides;
}

/** Layout for a booklet: each printed side is a landscape sheet holding two pages. */
export function planBooklet(pages: PageSize[], options: BookletOptions): SheetPlan[] {
  const sheet = sheetDimensions(options.sheet, true);
  const [left, right] = gridSlots(sheet, { cols: 2, rows: 1 }, options.margin, 0);
  return bookletSides(pages.length, options.rightToLeft).map(([l, r]) => ({
    ...sheet,
    slots: [
      { ...left, src: l },
      { ...right, src: r },
    ],
  }));
}

export function planLayout(pages: PageSize[], options: LayoutOptions): SheetPlan[] {
  return options.kind === "nup" ? planNUp(pages, options) : planBooklet(pages, options);
}

/** Output pages a layout produces for `count` source pages. */
export function layoutSheetCount(count: number, options: LayoutOptions): number {
  return options.kind === "nup"
    ? Math.ceil(count / options.perSheet)
    : (Math.ceil(count / 4) * 4) / 2;
}

type Rotation = 0 | 90 | 180 | 270;

/**
 * Where to put an embedded page's origin so that, drawn with the rotation that
 * undoes its /Rotate, its displayed box has its lower-left corner at (x, y).
 * `w`/`h` are the scaled size of the page as stored (before rotation).
 */
export function rotatedOrigin(
  rotation: Rotation,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; angle: number } {
  switch (rotation) {
    case 90:
      return { x, y: y + w, angle: -90 };
    case 180:
      return { x: x + w, y: y + h, angle: -180 };
    case 270:
      return { x: x + h, y, angle: -270 };
    default:
      return { x, y, angle: 0 };
  }
}

function normalizeRotation(angle: number): Rotation {
  return ((((Math.round(angle / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/**
 * Rearrange a PDF's pages for printing: several pages per sheet, or a folded
 * booklet. Operates on finished PDF bytes (edits already baked in). Pages are
 * placed as scaled copies of their content, so form fields, comments and links
 * do not carry over — bake or flatten them first (the export action does).
 */
export async function layoutPdf(
  bytes: Uint8Array | ArrayBuffer,
  options: LayoutOptions,
  password?: string,
): Promise<{ bytes: Uint8Array; sheets: number }> {
  const src = await loadPdfLibDocument(bytes, password);
  const srcPages = src.getPages();
  if (srcPages.length === 0) throw new Error("layoutPdf: the document has no pages");

  const rotations = srcPages.map((p) => normalizeRotation(p.getRotation().angle));
  const sizes: PageSize[] = srcPages.map((p, i) => {
    const { width, height } = p.getCropBox();
    return rotations[i] % 180 === 0 ? { width, height } : { width: height, height: width };
  });

  const out = await PDFDocument.create();
  // A page with no content stream (a blank inserted page) can't be embedded;
  // it still takes its slot, just empty.
  const drawable = srcPages.map((p, i) => (p.node.Contents() ? i : -1)).filter((i) => i >= 0);
  const embeddedPages = await out.embedPages(
    drawable.map((i) => srcPages[i]),
    drawable.map((i) => {
      const box = srcPages[i].getCropBox();
      return { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height };
    }),
  );
  const embedded = new Map<number, PDFEmbeddedPage>(drawable.map((i, k) => [i, embeddedPages[k]]));

  const plans = planLayout(sizes, options);
  for (const plan of plans) {
    const sheet = out.addPage([plan.width, plan.height]);
    for (const slot of plan.slots) {
      if (slot.src === null) continue;
      const size = sizes[slot.src];
      const scale = fitScale(size, slot.width, slot.height);
      const shownW = size.width * scale;
      const shownH = size.height * scale;
      const left = slot.x + (slot.width - shownW) / 2;
      const bottom = slot.y + (slot.height - shownH) / 2;
      const page = embedded.get(slot.src);
      if (page) {
        // The stored (unrotated) size is the displayed size, swapped for 90/270.
        const sideways = rotations[slot.src] % 180 !== 0;
        const origin = rotatedOrigin(
          rotations[slot.src],
          left,
          bottom,
          sideways ? shownH : shownW,
          sideways ? shownW : shownH,
        );
        sheet.drawPage(page, {
          x: origin.x,
          y: origin.y,
          xScale: scale,
          yScale: scale,
          rotate: degrees(origin.angle),
        });
      }
      if (options.border) {
        sheet.drawRectangle({
          x: left,
          y: bottom,
          width: shownW,
          height: shownH,
          borderColor: grayscale(0.6),
          borderWidth: 0.5,
        });
      }
    }
  }

  const title = src.getTitle();
  if (title) out.setTitle(title);
  return { bytes: await out.save({ useObjectStreams: true }), sheets: plans.length };
}
