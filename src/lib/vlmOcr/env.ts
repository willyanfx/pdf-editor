/**
 * Tiny, dependency-free environment probes for the VLM OCR engine. Kept separate
 * from index.ts so UI code can check WebGPU availability *without* statically
 * pulling Transformers.js (hundreds of KB) into the main bundle — the heavy
 * module is only loaded on demand when the user actually runs VLM OCR.
 */

/** Is WebGPU available at all? Gates the AI-OCR toggle in the UI. */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu != null;
}
