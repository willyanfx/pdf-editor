/**
 * Main-thread client for the Florence-2 VLM OCR engine.
 *
 * Exposes `recognizePageRegionVlm`, a drop-in alternative to tesseract's
 * `recognizePageRegion` (same signature, same `ScreenTextItem[]` return), so the
 * three OCR call-sites (OcrLayer, whole-page, all-pages) can dispatch on the
 * selected engine without other changes.
 *
 * Responsibilities here, all main-thread:
 *  - own the singleton worker and its request/response plumbing;
 *  - crop the page canvas to the requested region (in backing-store px);
 *  - hand the worker an ImageBitmap (transferred, zero-copy);
 *  - map the worker's image-px quad boxes back to screen px at VIEWER_WIDTH;
 *  - estimate font size + bold per region and emit ScreenTextItems.
 */

import type { ScreenTextItem } from "../textLayer";
import type { ScreenRegion, OcrProgress } from "../ocr";
import {
  estimateFontSizePx,
  inferBoldFromSize,
  median,
  quadDimensions,
  quadToRect,
  type Rect,
} from "./fontSize";
import type { VlmRegion, VlmResult, WorkerRequest, WorkerResponse } from "./types";

// --- worker lifecycle -------------------------------------------------------

let worker: Worker | null = null;
let nextRequestId = 1;
let ready = false;
let loadProgressCb: ((fraction: number) => void) | null = null;

type Pending = {
  resolve: (r: VlmResult) => void;
  reject: (e: Error) => void;
};
const pending = new Map<number, Pending>();
let readyResolvers: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./florence2.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    switch (msg.type) {
      case "load-progress": {
        // Aggregate per-file progress into a single coarse fraction. The model
        // ships several shards; the largest dominates, so the max-progress file
        // is a good-enough headline number for a download bar.
        if (msg.total > 0) loadProgressCb?.(msg.progress / 100);
        break;
      }
      case "ready": {
        ready = true;
        readyResolvers.forEach((r) => r.resolve());
        readyResolvers = [];
        break;
      }
      case "load-error": {
        const err = new Error(msg.message);
        readyResolvers.forEach((r) => r.reject(err));
        readyResolvers = [];
        // Allow a later call to recreate the worker and retry the load.
        teardown();
        break;
      }
      case "result": {
        pending.get(msg.requestId)?.resolve(msg.result);
        pending.delete(msg.requestId);
        break;
      }
      case "recognize-error": {
        pending.get(msg.requestId)?.reject(new Error(msg.message));
        pending.delete(msg.requestId);
        break;
      }
    }
  });
  worker.addEventListener("error", (e) => {
    const err = new Error(e.message || "VLM worker crashed");
    readyResolvers.forEach((r) => r.reject(err));
    readyResolvers = [];
    pending.forEach((p) => p.reject(err));
    pending.clear();
    teardown();
  });
  return worker;
}

function teardown() {
  worker?.terminate();
  worker = null;
  ready = false;
}

/** Tear down the worker to free GPU/host memory. Re-inits lazily on next use. */
export function terminateVlmOcr(): void {
  pending.forEach((p) => p.reject(new Error("VLM OCR terminated")));
  pending.clear();
  teardown();
}

/**
 * Eagerly load the model (e.g. when the user switches to the VLM engine) so the
 * first recognition isn't blocked behind a multi-hundred-MB download.
 * `onProgress` receives 0..1 download progress.
 */
export function preloadVlmOcr(onProgress?: (fraction: number) => void): Promise<void> {
  loadProgressCb = onProgress ?? null;
  if (ready) return Promise.resolve();
  const w = getWorker();
  const p = new Promise<void>((resolve, reject) => {
    readyResolvers.push({ resolve, reject });
  });
  (w.postMessage as (m: WorkerRequest) => void)({ type: "load" });
  return p;
}

export { isWebGpuAvailable } from "./env";

function runRecognize(image: ImageBitmap): Promise<VlmResult> {
  const w = getWorker();
  const requestId = nextRequestId++;
  return new Promise<VlmResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    (w.postMessage as (m: WorkerRequest, t: Transferable[]) => void)(
      { type: "recognize", requestId, image },
      [image],
    );
  });
}

// --- region projection ------------------------------------------------------

/**
 * Crop the page canvas to `region` (or the whole canvas) and return an
 * ImageBitmap plus the screen-space mapping needed to place the results.
 *
 * `ratio` = canvas backing-store px per screen px (devicePixelRatio for an
 * on-screen canvas, 1 for the off-screen all-pages render). The worker reports
 * quad boxes in the *bitmap's* px, which equal the crop's backing-store px, so
 * `screenPerImagePx = 1 / ratio` and we add the crop's screen origin.
 */
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
  // createImageBitmap can crop directly, avoiding an intermediate canvas.
  const bitmap = await createImageBitmap(canvas, sx, sy, sw, sh);
  return { bitmap, screenPerImagePx: 1 / ratio, offsetX: region.x, offsetY: region.y };
}

/** Map one VLM region (image-px quad) to a screen-px ScreenTextItem, deferring
 * font size to the page-level pass (which needs the median). */
function regionToScreenGeometry(
  region: VlmRegion,
  scale: number,
  offsetX: number,
  offsetY: number,
): { rect: Rect; lineHeight: number; runLength: number; text: string } {
  const quad = region.quad;
  const rectImg = quadToRect(quad);
  const { lineHeight, runLength } = quadDimensions(quad);
  const rect: Rect = {
    x: offsetX + rectImg.x * scale,
    y: offsetY + rectImg.y * scale,
    width: rectImg.width * scale,
    height: rectImg.height * scale,
  };
  return {
    rect,
    lineHeight: lineHeight * scale,
    runLength: runLength * scale,
    text: region.text,
  };
}

/**
 * Build ScreenTextItems from VLM regions. Two passes: first project geometry and
 * estimate per-region font size, then compute the page-median size to flag bold
 * headings relative to the body. Exported for unit testing the projection.
 */
export function regionsToScreenItems(
  regions: VlmRegion[],
  scale: number,
  offsetX: number,
  offsetY: number,
): ScreenTextItem[] {
  const geom = regions.map((r) => regionToScreenGeometry(r, scale, offsetX, offsetY));
  const sizes = geom.map((g) =>
    estimateFontSizePx(g.text, g.rect.height, g.lineHeight, g.runLength),
  );
  const med = median(sizes);
  return geom.map((g, i) => {
    const fontSize = sizes[i];
    return {
      id: `vlm-${i}`,
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

/**
 * Recognize text in a page canvas (optionally limited to `region`) with the
 * Florence-2 VLM, returning ScreenTextItems positioned in screen px at
 * `renderWidth`. Drop-in alternative to `recognizePageRegion` from ../ocr.
 *
 * `onProgress` here reports *load* progress (0..1) on the first call while the
 * model downloads; inference itself is not incrementally reported (Florence-2
 * generates in one shot), so progress jumps to 1 once decoding starts.
 *
 * `onWarning` fires with "truncated" when the page exceeded Florence-2's token
 * budget — the returned items are still valid but cover only the start of the
 * page, so the caller should tell the user the result is partial.
 */
export async function recognizePageRegionVlm(
  canvas: HTMLCanvasElement,
  renderWidth: number,
  region?: ScreenRegion,
  onProgress?: OcrProgress,
  onWarning?: (warning: "truncated") => void,
): Promise<ScreenTextItem[]> {
  // Ensure the model is loaded, surfacing download progress through onProgress.
  if (!ready) {
    await preloadVlmOcr((f) => onProgress?.(f));
  }
  onProgress?.(1);

  const { bitmap, screenPerImagePx, offsetX, offsetY } = await cropToBitmap(
    canvas,
    renderWidth,
    region,
  );
  const result = await runRecognize(bitmap);
  if (result.truncated) onWarning?.("truncated");
  return regionsToScreenItems(result.regions, screenPerImagePx, offsetX, offsetY);
}
