/**
 * Engine dispatcher: run OCR on a page canvas with whichever backend the user
 * selected, returning the shared `ScreenTextItem[]`. Both backends are loaded
 * lazily (dynamic import) so neither tesseract's WASM nor Transformers.js'
 * hundreds of MB are pulled into the initial bundle.
 */

import type { ScreenTextItem } from "../textLayer";
import type { ScreenRegion, OcrProgress } from "../ocr";
import type { OcrEngine } from "./types";

/** Non-fatal conditions a backend can surface (e.g. the Florence-2 token budget
 * was exhausted, so the page is partially recognized). The caller decides how to
 * present it; today the call-sites raise a toast. */
export type OcrWarning = "truncated";

export async function recognizeWithEngine(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  renderWidth: number,
  region?: ScreenRegion,
  onProgress?: OcrProgress,
  onWarning?: (warning: OcrWarning) => void,
): Promise<ScreenTextItem[]> {
  if (engine === "florence2") {
    const { recognizePageRegionVlm } = await import("./index");
    return recognizePageRegionVlm(canvas, renderWidth, region, onProgress, onWarning);
  }
  if (engine === "paddle") {
    // PaddleOCR is a det+rec pipeline with no fixed token budget, so it never
    // reports "truncated"; onWarning is unused on this path.
    const { recognizePageRegionPaddle } = await import("./paddleOcr");
    return recognizePageRegionPaddle(canvas, renderWidth, region, onProgress);
  }
  // The tesseract path has no token budget either, so it never reports "truncated".
  const { recognizePageRegion } = await import("../ocr");
  return recognizePageRegion(canvas, renderWidth, region, onProgress);
}
