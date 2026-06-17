/**
 * Shared types for the in-browser VLM OCR engine (Florence-2 via Transformers.js
 * on WebGPU). Imported by BOTH the main-thread client and the Web Worker, so it
 * must stay free of any DOM/worker-only globals.
 */

import type { QuadBox } from "./fontSize";

/** Which OCR backend to run. "tesseract" is the existing WASM path; "florence2"
 * is the VLM path that returns layout + boxes; "paddle" is the PaddleOCR.js
 * detection+recognition pipeline (beta) — small models, per-line polygons. */
export type OcrEngine = "tesseract" | "florence2" | "paddle";

/** One text region the VLM recognized, in *image* pixel space (the pixels of the
 * ImageBitmap that was sent to the worker). The main-thread client maps these to
 * screen px before building ScreenTextItems. */
export type VlmRegion = {
  text: string;
  /** Quad box [x1,y1..x4,y4] in image px. */
  quad: QuadBox;
};

/** The worker's recognition result for one image. */
export type VlmResult = {
  regions: VlmRegion[];
  /** The pixel dimensions of the image the boxes are expressed in. */
  imageWidth: number;
  imageHeight: number;
  /** True when generation hit the token budget without emitting EOS, i.e. the
   * region list is incomplete (a dense page was cut off). The caller should warn
   * the user rather than silently dropping the tail of the page. */
  truncated: boolean;
};

// --- main thread → worker ---------------------------------------------------

export type WorkerRequest =
  | { type: "load" }
  | {
      type: "recognize";
      /** Monotonic id so out-of-order replies can be matched/ignored. */
      requestId: number;
      /** The page bitmap. Transferred (zero-copy) — the main thread loses it. */
      image: ImageBitmap;
    };

// --- worker → main thread ---------------------------------------------------

export type WorkerResponse =
  | { type: "load-progress"; file: string; progress: number; loaded: number; total: number }
  | { type: "ready" }
  | { type: "load-error"; message: string }
  | { type: "result"; requestId: number; result: VlmResult }
  | { type: "recognize-error"; requestId: number; message: string };

/** The Florence-2 ONNX repo (Transformers.js-native, WebGPU-capable). The `-ft`
 * fine-tune is the one the official florence2-webgpu demo uses and is markedly
 * better at the `<OCR_WITH_REGION>` task than the base checkpoint. */
export const FLORENCE_MODEL_ID = "onnx-community/Florence-2-base-ft";

/** Florence-2 task token that yields text WITH per-region quad boxes. */
export const OCR_WITH_REGION_TASK = "<OCR_WITH_REGION>";
