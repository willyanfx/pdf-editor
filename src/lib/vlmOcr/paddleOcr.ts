/**
 * Main-thread client for the PaddleOCR.js engine (beta).
 *
 * PaddleOCR.js (`@paddleocr/paddleocr-js`) is a detection+recognition pipeline
 * built on ONNX Runtime Web + OpenCV.js. Unlike Florence-2 it is not a VLM: a
 * detector finds text-line polygons, then a recognizer reads each crop. Models
 * are small (PP-OCRv5 mobile det+rec, a few MB) versus Florence-2's ~275 MB.
 *
 * This module mirrors `recognizePageRegionVlm` so the dispatcher can treat all
 * three engines identically: same signature, same `ScreenTextItem[]` return.
 *
 * Constraints honored (see ../../README + the OCR evaluation):
 *  - GitHub Pages can't set COOP/COEP, so SharedArrayBuffer is unavailable. We
 *    pin `numThreads: 1` and let the backend fall back from WebGPU to single-
 *    thread WASM — never multi-thread WASM, which would need SharedArrayBuffer.
 *  - Models load from the PaddlePaddle (Baidu) CDN by default. That is the main
 *    reliability caveat behind the "beta" label; the create options expose
 *    `textDetectionModelAsset` / `textRecognitionModelAsset` for self-hosting
 *    the `.tar` files later without touching this module's public surface.
 */

import type {
  PaddleOCR as PaddleOCRClass,
  OcrResult,
  OcrResultItem,
} from "@paddleocr/paddleocr-js";
import type { ScreenTextItem } from "../textLayer";
import type { ScreenRegion, OcrProgress } from "../ocr";
import {
  estimateFontSizePx,
  inferBoldFromSize,
  median,
  quadDimensions,
  quadToRect,
  type QuadBox,
  type Rect,
} from "./fontSize";

// PaddleOCR.create resolves to either the direct runner or a worker-backed proxy
// depending on `worker`; both expose predict()/dispose(), which is all we use.
type PaddleInstance = Awaited<ReturnType<typeof PaddleOCRClass.create>>;

let instance: PaddleInstance | null = null;
let loadPromise: Promise<PaddleInstance> | null = null;

/**
 * Create (once) the PaddleOCR pipeline. The detector/recognizer ONNX models are
 * fetched on first use; the returned promise resolves when they're loaded. A
 * failed load is not cached so a later call can retry (e.g. transient CDN error).
 */
function load(): Promise<PaddleInstance> {
  if (instance) return Promise.resolve(instance);
  if (loadPromise) return loadPromise;

  const p = (async () => {
    const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
    const ocr = await PaddleOCR.create({
      // English document text. PP-OCRv5 mobile is the small det/rec pair.
      lang: "en",
      ocrVersion: "PP-OCRv5",
      // Run inference off the main thread so the editor stays responsive.
      worker: true,
      ortOptions: {
        // "auto" uses WebGPU when available and falls back to WASM otherwise.
        backend: "auto",
        // CRITICAL: single-thread only. Multi-thread WASM needs SharedArrayBuffer,
        // which requires COOP/COEP headers we cannot set on GitHub Pages.
        numThreads: 1,
        simd: true,
        // onnxruntime-web wasm assets from the same CDN the package defaults to.
        wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/",
      },
    });
    instance = ocr;
    return ocr;
  })();

  loadPromise = p;
  p.catch(() => {
    loadPromise = null;
  });
  return p;
}

/**
 * Eagerly load the models (e.g. when the user switches to this engine) so the
 * first recognition isn't blocked behind the model download. PaddleOCR.js does
 * not stream granular download progress, so `onProgress` is only pulsed to 0
 * then 1 — enough to drive an indeterminate spinner in the UI.
 */
export async function preloadPaddleOcr(onProgress?: (fraction: number) => void): Promise<void> {
  if (instance) {
    onProgress?.(1);
    return;
  }
  onProgress?.(0);
  await load();
  onProgress?.(1);
}

/** Dispose the pipeline (frees the worker + ONNX sessions). Re-inits lazily. */
export async function terminatePaddleOcr(): Promise<void> {
  const current = instance;
  instance = null;
  loadPromise = null;
  if (current) await current.dispose();
}

// --- geometry ----------------------------------------------------------------

/** PaddleOCR returns a polygon as an array of [x,y] points (usually 4). Flatten
 * the first four points into the 8-number QuadBox the geometry helpers expect,
 * padding by repeating the last point if a degenerate polygon has fewer than 4. */
function polyToQuad(poly: Array<[number, number]>): QuadBox | null {
  if (poly.length < 2) return null;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    pts.push(poly[Math.min(i, poly.length - 1)]);
  }
  return [pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]];
}

/**
 * Map PaddleOCR result items (image-px polygons) to screen-px ScreenTextItems.
 * Same two-pass approach as the VLM path: project geometry + per-item font size,
 * then use the page-median size to flag bold lines relative to the body.
 * Exported for unit testing the projection.
 */
export function paddleItemsToScreenItems(
  items: OcrResultItem[],
  scale: number,
  offsetX: number,
  offsetY: number,
): ScreenTextItem[] {
  const geom: Array<{ rect: Rect; lineHeight: number; runLength: number; text: string }> = [];
  for (const it of items) {
    const text = it.text.trim();
    if (!text) continue;
    const quad = polyToQuad(it.poly as Array<[number, number]>);
    if (!quad) continue;
    const rectImg = quadToRect(quad);
    const { lineHeight, runLength } = quadDimensions(quad);
    geom.push({
      rect: {
        x: offsetX + rectImg.x * scale,
        y: offsetY + rectImg.y * scale,
        width: rectImg.width * scale,
        height: rectImg.height * scale,
      },
      lineHeight: lineHeight * scale,
      runLength: runLength * scale,
      text,
    });
  }

  const sizes = geom.map((g) =>
    estimateFontSizePx(g.text, g.rect.height, g.lineHeight, g.runLength),
  );
  const med = median(sizes);
  return geom.map((g, i) => {
    const fontSize = sizes[i];
    return {
      id: `paddle-${i}`,
      str: g.text,
      x: g.rect.x,
      y: g.rect.y,
      width: g.rect.width,
      height: g.rect.height,
      fontSize,
      fontFamily: "Helvetica" as const,
      bold: inferBoldFromSize(fontSize, med),
      italic: false,
    };
  });
}

// --- region cropping (mirrors index.ts cropToBitmap) -------------------------

async function cropToBitmap(
  canvas: HTMLCanvasElement,
  renderWidth: number,
  region: ScreenRegion | undefined,
): Promise<{ bitmap: ImageBitmap; screenPerImagePx: number; offsetX: number; offsetY: number }> {
  const ratio = canvas.width / renderWidth;
  if (!region) {
    const bitmap = await createImageBitmap(canvas);
    return { bitmap, screenPerImagePx: 1 / ratio, offsetX: 0, offsetY: 0 };
  }
  const sx = Math.max(0, Math.round(region.x * ratio));
  const sy = Math.max(0, Math.round(region.y * ratio));
  const sw = Math.min(Math.round(region.width * ratio), canvas.width - sx);
  const sh = Math.min(Math.round(region.height * ratio), canvas.height - sy);
  if (sw <= 0 || sh <= 0) throw new Error("Empty OCR region");
  const bitmap = await createImageBitmap(canvas, sx, sy, sw, sh);
  return { bitmap, screenPerImagePx: 1 / ratio, offsetX: region.x, offsetY: region.y };
}

/**
 * Recognize text in a page canvas (optionally limited to `region`) with the
 * PaddleOCR.js pipeline, returning ScreenTextItems positioned in screen px at
 * `renderWidth`. Drop-in alternative to `recognizePageRegion` / the VLM path.
 *
 * `onProgress` reports model-load progress (0..1) on the first call only;
 * inference itself is not incrementally reported.
 */
export async function recognizePageRegionPaddle(
  canvas: HTMLCanvasElement,
  renderWidth: number,
  region?: ScreenRegion,
  onProgress?: OcrProgress,
): Promise<ScreenTextItem[]> {
  // load() returns the existing instance immediately or creates it; surface the
  // download as 0→1 on onProgress for the first call.
  if (!instance) onProgress?.(0);
  const ocr = await load();
  onProgress?.(1);

  const { bitmap, screenPerImagePx, offsetX, offsetY } = await cropToBitmap(
    canvas,
    renderWidth,
    region,
  );
  // predict() takes the ImageBitmap directly and returns one OcrResult per input.
  const results: OcrResult[] = await ocr.predict(bitmap);
  const items = results[0]?.items ?? [];
  return paddleItemsToScreenItems(items, screenPerImagePx, offsetX, offsetY);
}
