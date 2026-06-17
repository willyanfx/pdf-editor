import Tesseract, { createWorker, PSM } from "tesseract.js";
import type { ScreenTextItem } from "./textLayer";

type Worker = Tesseract.Worker;

/** Region of a page in screen px (the viewer's CSS coordinate system). */
export type ScreenRegion = { x: number; y: number; width: number; height: number };

/** Progress callback: 0..1 during recognition. */
export type OcrProgress = (progress: number) => void;

// --- Worker lifecycle -------------------------------------------------------
// One worker, created lazily on first OCR, reused across calls. Re-initializing
// is the slow part, so we never terminate per call. tesseract.js loads its
// worker/core/lang assets from a CDN at runtime — the user's image bytes are
// processed entirely in the WASM worker and never leave the browser.

let workerPromise: Promise<Worker> | null = null;
let progressCb: OcrProgress | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker("eng", undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") progressCb?.(m.progress);
    },
  }).then(async (worker) => {
    // One-time tuning that survives across jobs:
    // - preserve_interword_spaces keeps Tesseract from collapsing variable
    //   inter-word gaps, the main cause of "rn"→"m"-class run-together errors.
    // - user_defined_dpi stops the bogus-DPI estimation path (canvas inputs
    //   carry no embedded DPI) and steadies point-size estimation.
    // - thresholding_method 2 = Sauvola, better local binarization for
    //   segmentation than the default global Otsu, at no bundle cost.
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      thresholding_method: "2",
    });
    return worker;
  });
  // Don't cache a rejected init (e.g. a transient CDN failure fetching the
  // worker/lang assets) — clear it so the next call retries instead of being
  // permanently dead until reload.
  workerPromise.catch(() => {
    workerPromise = null;
  });
  return workerPromise;
}

// Serialize jobs: one worker processes one job at a time, so chain calls through
// a single promise to prevent concurrent triggers from corrupting each other.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  // Keep the chain alive even if a job rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Terminate the worker to free memory. Safe to call anytime; it re-inits lazily. */
export async function terminateOcrWorker(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) await (await p).terminate();
}

// --- Recognition ------------------------------------------------------------

export type OcrBbox = { x0: number; y0: number; x1: number; y1: number };
export type OcrLine = { text: string; bbox: OcrBbox };
/** A reconstructed text block: one body paragraph OR one list item. `isBold` is
 * filled later by ink-density analysis (see detectBoldParagraphs). */
export type OcrParagraph = { text: string; bbox: OcrBbox; isListItem: boolean; isBold: boolean };

// --- Tesseract blocks-tree shapes (only the fields we read) ----------------

type TessWord = {
  text?: string;
  bbox?: OcrBbox;
  /** Per-word bold flag. Declared in v5 types but structurally ALWAYS false
   * under the default LSTM engine (OEM 1) — kept only as a free OR-signal in case
   * a legacy engine is ever enabled. Real bold detection uses ink density. */
  is_bold?: boolean;
};
type TessLine = {
  text?: string;
  bbox?: OcrBbox;
  words?: TessWord[];
  rowAttributes?: { row_height?: number };
};
type TessParagraph = { lines?: TessLine[] };
type TessBlock = { paragraphs?: TessParagraph[] };

type CollectedLine = {
  text: string;
  bbox: OcrBbox;
  firstX: number;
  rowHeight: number;
  /** True only if every word on the line reported is_bold (almost never under LSTM). */
  allWordsBold: boolean;
};

/** Flatten the v5 blocks tree to a flat, ordered list of usable lines, keeping
 * each line's first-word x0 (for indent/list detection) and a row-height hint. */
function collectLines(data: unknown): CollectedLine[] {
  const blocks = (data as { blocks?: TessBlock[] } | undefined)?.blocks;
  if (!Array.isArray(blocks)) return [];
  const out: CollectedLine[] = [];
  for (const block of blocks) {
    if (!Array.isArray(block.paragraphs)) continue;
    for (const para of block.paragraphs) {
      if (!Array.isArray(para.lines)) continue;
      for (const line of para.lines) {
        const text = (line.text ?? "").replace(/\n+$/, "");
        if (!text.trim() || !line.bbox) continue;
        const words = line.words?.filter((w) => (w.text ?? "").trim() !== "") ?? [];
        const firstWord = words[0];
        out.push({
          text,
          bbox: line.bbox,
          firstX: firstWord?.bbox?.x0 ?? line.bbox.x0,
          // row_height may be undefined depending on the core build; fall back
          // to the bbox height.
          rowHeight: line.rowAttributes?.row_height ?? line.bbox.y1 - line.bbox.y0,
          allWordsBold: words.length > 0 && words.every((w) => w.is_bold === true),
        });
      }
    }
  }
  return out;
}

// True bullet/number markers we trust outright. Exported so the DOCX exporter
// can classify a text block as a list item from its text alone.
export const MARKER_RE = /^[\s]*([-•◦▪*–—]|\d+[.):]|[A-Za-z][.):]|[ivxlcdmIVXLCDM]+\.)\s+/;
// Glyphs OCR commonly substitutes for a round/filled bullet (•). Only treated as
// a bullet when they lead the line AND are followed by a capitalized word, so we
// don't mistake mid-sentence punctuation or real words for a marker.
const MISREAD_BULLET_RE = /^[\s]*([«»‹›·°]) +(?=[A-Z0-9])/;

function isMarkerLine(text: string): boolean {
  return MARKER_RE.test(text) || MISREAD_BULLET_RE.test(text);
}

/** Rewrite a leading misread bullet glyph to a canonical "• ". */
function canonicalizeMarker(text: string): string {
  return text.replace(MISREAD_BULLET_RE, "• ");
}

const LIGATURES: [RegExp, string][] = [
  [/ﬀ/g, "ff"],
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
];

/** NFC-normalize and restore common ligature codepoints to plain ASCII. */
function normalizeText(s: string): string {
  let out = s.normalize("NFC");
  for (const [re, rep] of LIGATURES) out = out.replace(re, rep);
  return out;
}

/** Join two visual lines that belong to the same paragraph. De-hyphenate when
 * the left line ends in a hyphen and the right starts lowercase (a soft break). */
function joinWrapped(left: string, right: string): string {
  if (/[A-Za-z]-$/.test(left) && /^[a-z]/.test(right)) {
    return left.slice(0, -1) + right;
  }
  return left + " " + right;
}

function unionBbox(a: OcrBbox, b: OcrBbox): OcrBbox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Reconstruct paragraphs and list items from the blocks tree using line
 * geometry, fixing the two structural problems of the old per-line model:
 *  - paragraphs that should be one box (split at every soft wrap), and
 *  - bullet/numbered items that should each be their own box.
 *
 * Heuristics (all pure geometry, no ML):
 *  - A vertical gap larger than `gapRatio × median row height` starts a new
 *    group (handles paragraph boundaries Tesseract merged or kept).
 *  - Within a group, a line whose first word is indented past the group's modal
 *    left edge — or whose text starts with a bullet/number marker — starts a new
 *    list item; less-indented continuation lines append to the current item.
 */
export function paragraphsFromData(data: unknown, gapRatio = 1.3): OcrParagraph[] {
  const lines = collectLines(data);
  if (lines.length === 0) return [];

  const rowHeights = lines
    .map((l) => l.rowHeight)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const medianRow = rowHeights.length
    ? rowHeights[Math.floor(rowHeights.length / 2)]
    : lines[0].bbox.y1 - lines[0].bbox.y0;

  // The body left margin: the most common first-word x0 across all lines.
  const modalLeft = modeOf(lines.map((l) => Math.round(l.firstX)));

  const out: OcrParagraph[] = [];
  let cur: OcrParagraph | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : null;
    const next = i + 1 < lines.length ? lines[i + 1] : null;

    const gapAbove = prev ? line.bbox.y0 - prev.bbox.y1 > gapRatio * medianRow : false;
    const marker = isMarkerLine(line.text);
    const indented = line.firstX - modalLeft > 8; // hanging-indent / list marker column
    // Heading-before-bullet: a non-marker line immediately followed by a marker
    // line is a section heading sitting just above its list. Force a break so the
    // heading gets its own block instead of merging into the first bullet.
    const headingBeforeList = !marker && next != null && isMarkerLine(next.text);
    const bigGap = gapAbove || headingBeforeList;
    // A marker line ALWAYS starts its own item — list bullets often sit at the
    // same left edge as body text and have only small inter-line gaps, so the
    // marker is the reliable signal, not geometry.
    const startsListItem = marker || (indented && gapAbove);
    const cleaned = canonicalizeMarker(normalizeText(line.text));

    // Start a fresh group on a paragraph gap or a new list item.
    if (cur === null || bigGap || startsListItem) {
      if (cur) out.push(cur);
      cur = {
        text: cleaned,
        bbox: line.bbox,
        isListItem: marker || indented,
        // Preliminary bold from word flags (≈always false under LSTM); refined by
        // ink density in detectBoldParagraphs.
        isBold: line.allWordsBold,
      };
    } else {
      cur.text = joinWrapped(cur.text, cleaned);
      cur.bbox = unionBbox(cur.bbox, line.bbox);
      cur.isBold = cur.isBold && line.allWordsBold;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Refine each paragraph's `isBold` flag using ink density on the (pre-processed)
 * OCR canvas. Bold text lays down more dark ink per unit area than body text, so
 * a short line that is markedly darker than the page median is almost certainly a
 * heading. Mutates the paragraphs in place.
 *
 * `bboxScale` maps an OcrParagraph bbox (in source-canvas px) onto `canvas`
 * (the processed/up-scaled canvas the bboxes were actually measured on → 1).
 */
export function detectBoldParagraphs(
  paras: OcrParagraph[],
  canvas: HTMLCanvasElement,
  bboxScale = 1,
): void {
  if (paras.length === 0) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const densities = paras.map((p) => {
    const x = Math.max(0, Math.floor(p.bbox.x0 * bboxScale));
    const y = Math.max(0, Math.floor(p.bbox.y0 * bboxScale));
    const w = Math.min(canvas.width - x, Math.ceil((p.bbox.x1 - p.bbox.x0) * bboxScale));
    const h = Math.min(canvas.height - y, Math.ceil((p.bbox.y1 - p.bbox.y0) * bboxScale));
    if (w <= 0 || h <= 0) return 0;
    const { data } = ctx.getImageData(x, y, w, h);
    let dark = 0;
    const total = w * h;
    for (let i = 0; i < data.length; i += 4) {
      // The processed canvas is greyscale, so the red channel ≈ luminance.
      if (data[i] < 128) dark++;
    }
    return total > 0 ? dark / total : 0;
  });

  const sorted = [...densities].filter((d) => d > 0).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  if (median <= 0) return;

  paras.forEach((p, i) => {
    const wordCount = p.text.trim().split(/\s+/).length;
    // Bold text lays down more ink than body text regardless of length, so the
    // density margin is the real discriminator — not word count. We keep a floor
    // (BOLD_MIN_WORDS) to reject dense one-word OCR fragments, but no ceiling:
    // multi-word bold callouts and sub-headings were previously dropped, which
    // silently mis-classified them as body text in the DOCX export.
    const denser = densities[i] > median * BOLD_DENSITY_RATIO;
    if (!p.isListItem && wordCount >= BOLD_MIN_WORDS && denser) {
      p.isBold = true;
    }
  });
}

/** A paragraph is flagged bold when its ink density exceeds the page median by
 * this factor (and it is short / not a list item). Calibrated on the Rapha scan,
 * where true headings measured 1.49–1.8× the page median while body/bullets sat
 * at ≤1.03×, giving clean separation at 1.45×. Tunable per document. */
const BOLD_DENSITY_RATIO = 1.45;
/** Bold runs are at least two words — excludes dense one-word OCR fragments
 * (e.g. a misread glyph reading as a single dark blob). There is deliberately no
 * upper bound: bold body paragraphs and multi-sentence callouts are still bold. */
const BOLD_MIN_WORDS = 2;

/** Most frequent value in a small numeric array (ties → first seen). */
function modeOf(nums: number[]): number {
  const counts = new Map<number, number>();
  let best = nums[0];
  let bestN = 0;
  for (const n of nums) {
    const c = (counts.get(n) ?? 0) + 1;
    counts.set(n, c);
    if (c > bestN) {
      bestN = c;
      best = n;
    }
  }
  return best;
}

/**
 * @deprecated Kept for the original per-line behaviour and unit tests. New code
 * uses {@link paragraphsFromData}. Pulls line-level results from the v5 blocks tree.
 */
export function linesFromData(data: unknown): OcrLine[] {
  const blocks = (data as { blocks?: unknown[] } | undefined)?.blocks;
  if (!Array.isArray(blocks)) return [];
  const lines: OcrLine[] = [];
  for (const block of blocks) {
    const paragraphs = (block as { paragraphs?: unknown[] }).paragraphs;
    if (!Array.isArray(paragraphs)) continue;
    for (const para of paragraphs) {
      const paraLines = (para as { lines?: unknown[] }).lines;
      if (!Array.isArray(paraLines)) continue;
      for (const line of paraLines) {
        const l = line as { text?: string; bbox?: OcrBbox };
        if (l.text && l.text.trim() !== "" && l.bbox) {
          lines.push({ text: l.text.replace(/\n+$/, ""), bbox: l.bbox });
        }
      }
    }
  }
  return lines;
}

/**
 * Up-scale toward ~300 DPI and apply greyscale + contrast to lift OCR accuracy.
 * Canvas inputs from react-pdf are often near 96 effective DPI at 1×
 * devicePixelRatio, well below Tesseract's sweet spot. Returns the original
 * canvas unchanged if no work is needed or a 2D context is unavailable.
 *
 * `pageWidthIn` is the source page width in inches; for a crop, pass the FULL
 * page width so the DPI estimate stays correct.
 */
function preprocessForOcr(canvas: HTMLCanvasElement, pageWidthIn: number): HTMLCanvasElement {
  // A degenerate canvas (or a zero page width) would make the DPI math NaN and
  // produce a 0×0 output; pass it through untouched instead.
  if (!canvas.width || !canvas.height || pageWidthIn <= 0) return canvas;
  const effectiveDpi = canvas.width / pageWidthIn;
  // Cap by scale (≤4×) and by absolute longest side (≤4800px) to avoid GPU OOM.
  let scale = Math.min(4, Math.max(1, 300 / effectiveDpi));
  const longest = Math.max(canvas.width, canvas.height) * scale;
  if (longest > 4800) scale *= 4800 / longest;

  const w = Math.round(canvas.width * scale);
  const h = Math.round(canvas.height * scale);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  if (!ctx) return canvas;

  // `filter` is a single GPU pass where supported (Chrome/Firefox). Safari lacks
  // it on 2D contexts, so fall back to a manual luminance + contrast pass.
  const supportsFilter = typeof ctx.filter === "string";
  if (supportsFilter) {
    ctx.filter = "grayscale(100%) contrast(135%)";
    ctx.drawImage(canvas, 0, 0, w, h);
    ctx.filter = "none";
  } else {
    ctx.drawImage(canvas, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const k = 1.35; // contrast factor, matches the CSS filter above
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const c = Math.max(0, Math.min(255, (lum - 128) * k + 128));
      d[i] = d[i + 1] = d[i + 2] = c;
    }
    ctx.putImageData(img, 0, 0);
  }
  return off;
}

/** Recognize an image/canvas and reconstruct paragraphs. The 3rd recognize arg
 * `{ blocks: true }` is REQUIRED in tesseract.js v5 to get bounding boxes — with
 * the default output you get text only and zero boxes. `psm` tunes layout
 * analysis per call-site (AUTO for full pages, SINGLE_BLOCK for crops/images). */
async function recognizeParagraphs(
  image: HTMLCanvasElement | HTMLImageElement,
  psm: PSM,
  onProgress?: OcrProgress,
): Promise<OcrParagraph[]> {
  return enqueue(async () => {
    const worker = await getWorker();
    progressCb = onProgress ?? null;
    try {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data } = await worker.recognize(image, {}, { blocks: true });
      const paras = paragraphsFromData(data);
      // bboxes come back in `image`'s pixel space, so sample bold straight off it
      // (it's the processed/greyscale canvas when called from recognizePageRegion).
      if (image instanceof HTMLCanvasElement) detectBoldParagraphs(paras, image, 1);
      return paras;
    } finally {
      progressCb = null;
    }
  });
}

/** Build a ScreenTextItem from a recognized text box (line or paragraph),
 * mapping its bbox to screen px via the given per-axis scale and offset. For a
 * multi-line paragraph, font size is estimated from a single line's height
 * rather than the whole box. */
function ocrBoxToScreenItem(
  box: OcrParagraph,
  index: number,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
): ScreenTextItem {
  const { x0, y0, x1, y1 } = box.bbox;
  const width = (x1 - x0) * scaleX;
  const height = (y1 - y0) * scaleY;
  // A paragraph box may span several visual lines; estimate the per-line height
  // so the font size stays reasonable instead of scaling with the whole block.
  const lineCount = box.text.split("\n").length;
  const lineHeight = height / lineCount;
  return {
    id: `ocr-${index}`,
    str: box.text,
    x: offsetX + x0 * scaleX,
    y: offsetY + y0 * scaleY,
    width,
    height,
    // OCR carries no font name; estimate size from line height (inverse of the
    // height = fontSize * 1.2 convention used elsewhere). Bold comes from
    // ink-density detection (detectBoldParagraphs); italic is not detected.
    fontSize: lineHeight / 1.2,
    fontFamily: "Helvetica",
    bold: box.isBold,
    italic: false,
  };
}

/**
 * @deprecated Per-line projection kept for unit tests; new code projects
 * paragraphs via {@link ocrBoxToScreenItem}. Single-line height so font size is
 * derived from the box height directly.
 */
export function ocrLineToScreenItem(
  line: OcrLine,
  index: number,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
): ScreenTextItem {
  const { x0, y0, x1, y1 } = line.bbox;
  const width = (x1 - x0) * scaleX;
  const height = (y1 - y0) * scaleY;
  return {
    id: `ocr-${index}`,
    str: line.text,
    x: offsetX + x0 * scaleX,
    y: offsetY + y0 * scaleY,
    width,
    height,
    fontSize: height / 1.2,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
  };
}

/**
 * OCR a page canvas, optionally limited to `region` (screen px). Returns one
 * ScreenTextItem per recognized line, positioned in screen px at `renderWidth`.
 *
 * The page canvas backing store is at devicePixelRatio, so `ratio` converts
 * screen px ↔ canvas px (same pattern as sampleBackgroundColor in textLayer.ts).
 */
export async function recognizePageRegion(
  canvas: HTMLCanvasElement,
  renderWidth: number,
  region?: ScreenRegion,
  onProgress?: OcrProgress,
): Promise<ScreenTextItem[]> {
  const ratio = canvas.width / renderWidth; // canvas px per screen px
  // Page width in inches for the DPI estimate (always the FULL page, not the crop).
  const pageWidthIn = canvas.width / (96 * ratio || 96);

  let input: HTMLCanvasElement = canvas;
  let offsetX = 0;
  let offsetY = 0;
  // A whole page → AUTO segmentation (handles columns); a crop is usually a
  // single block, where AUTO tends to mis-split, so use SINGLE_BLOCK.
  let psm: PSM = PSM.AUTO;

  if (region) {
    // Crop into an offscreen canvas in backing-store px.
    const sx = Math.max(0, Math.round(region.x * ratio));
    const sy = Math.max(0, Math.round(region.y * ratio));
    const sw = Math.max(1, Math.round(region.width * ratio));
    const sh = Math.max(1, Math.round(region.height * ratio));
    const off = document.createElement("canvas");
    off.width = Math.min(sw, canvas.width - sx);
    off.height = Math.min(sh, canvas.height - sy);
    const ctx = off.getContext("2d");
    if (!ctx || off.width <= 0 || off.height <= 0) return [];
    ctx.drawImage(canvas, sx, sy, off.width, off.height, 0, 0, off.width, off.height);
    input = off;
    // Tesseract bboxes are in the crop's pixel space; divide by ratio to get
    // screen px, then add the crop's screen-space origin.
    offsetX = region.x;
    offsetY = region.y;
    psm = PSM.SINGLE_BLOCK;
  }

  // Up-scale + greyscale before OCR; the bboxes come back in the PROCESSED
  // canvas's px, so fold the extra scale into the screen mapping.
  const processed = preprocessForOcr(input, pageWidthIn);
  const preScale = processed.width / input.width; // processed px per crop px
  const screenPerCanvas = 1 / (ratio * preScale);

  const paras = await recognizeParagraphs(processed, psm, onProgress);
  return paras.map((p, i) =>
    ocrBoxToScreenItem(p, i, screenPerCanvas, screenPerCanvas, offsetX, offsetY),
  );
}

/**
 * OCR an image data URL (an added image/signature edit). `displayBox` is the
 * edit's on-screen box in screen px. The image is recognized at its natural
 * pixel size, so the mapping uses natural dimensions — NOT devicePixelRatio.
 */
export async function recognizeImageDataUrl(
  dataUrl: string,
  displayBox: ScreenRegion,
  onProgress?: OcrProgress,
): Promise<ScreenTextItem[]> {
  const img = await loadImage(dataUrl);
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  if (!naturalWidth || !naturalHeight) return [];

  // Draw to a canvas so we can pre-process (greyscale/contrast/upscale). Assume
  // a ~96 DPI source so the DPI estimate uses natural-px width in inches.
  const base = document.createElement("canvas");
  base.width = naturalWidth;
  base.height = naturalHeight;
  const bctx = base.getContext("2d");
  if (!bctx) return [];
  bctx.drawImage(img, 0, 0);
  const processed = preprocessForOcr(base, naturalWidth / 96);
  const preScale = processed.width / naturalWidth; // processed px per image px

  // screen px per PROCESSED px: undo the pre-scale, then map image px → display px.
  const scaleX = displayBox.width / naturalWidth / preScale;
  const scaleY = displayBox.height / naturalHeight / preScale;

  // A single inserted image/signature is one block, not a multi-column page.
  const paras = await recognizeParagraphs(processed, PSM.SINGLE_BLOCK, onProgress);
  return paras.map((p, i) => ocrBoxToScreenItem(p, i, scaleX, scaleY, displayBox.x, displayBox.y));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for OCR"));
    img.src = src;
  });
}
