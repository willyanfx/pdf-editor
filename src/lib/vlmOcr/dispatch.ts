/**
 * Engine dispatcher: run OCR on a page canvas with whichever backend the user
 * selected, returning the shared `ScreenTextItem[]`. Both backends are loaded
 * lazily (dynamic import) so neither tesseract's WASM nor Transformers.js'
 * hundreds of MB are pulled into the initial bundle.
 */

import type { ScreenTextItem } from "../textLayer";
import type { ScreenRegion, OcrProgress } from "../ocr";
import type { OcrEngine } from "./types";

export async function recognizeWithEngine(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  renderWidth: number,
  region?: ScreenRegion,
  onProgress?: OcrProgress,
): Promise<ScreenTextItem[]> {
  if (engine === "florence2") {
    const { recognizePageRegionVlm } = await import("./index");
    return recognizePageRegionVlm(canvas, renderWidth, region, onProgress);
  }
  const { recognizePageRegion } = await import("../ocr");
  return recognizePageRegion(canvas, renderWidth, region, onProgress);
}
