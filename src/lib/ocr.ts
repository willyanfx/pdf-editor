import Tesseract, { createWorker } from "tesseract.js";
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

/** Pull line-level results out of the v5 blocks tree. */
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

/** Recognize an image element/canvas; returns the raw line list. The 3rd arg
 * `{ blocks: true }` is REQUIRED in tesseract.js v5 to get bounding boxes — with
 * the default output you get text only and zero boxes. */
async function recognizeLines(
  image: HTMLCanvasElement | HTMLImageElement,
  onProgress?: OcrProgress,
): Promise<OcrLine[]> {
  return enqueue(async () => {
    const worker = await getWorker();
    progressCb = onProgress ?? null;
    try {
      const { data } = await worker.recognize(image, {}, { blocks: true });
      return linesFromData(data);
    } finally {
      progressCb = null;
    }
  });
}

/** Build a ScreenTextItem from a recognized line, mapping its bbox to screen px
 * via the given per-axis scale and screen-space offset. */
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
    // OCR carries no font metadata; estimate size from box height (inverse of
    // the height = fontSize * 1.2 convention used elsewhere) and default family.
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

  let input: HTMLCanvasElement = canvas;
  let offsetX = 0;
  let offsetY = 0;

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
  }

  const lines = await recognizeLines(input, onProgress);
  return lines.map((line, i) =>
    ocrLineToScreenItem(line, i, 1 / ratio, 1 / ratio, offsetX, offsetY),
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

  const scaleX = displayBox.width / naturalWidth; // screen px per image px, X
  const scaleY = displayBox.height / naturalHeight; // screen px per image px, Y

  const lines = await recognizeLines(img, onProgress);
  return lines.map((line, i) =>
    ocrLineToScreenItem(line, i, scaleX, scaleY, displayBox.x, displayBox.y),
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for OCR"));
    img.src = src;
  });
}
