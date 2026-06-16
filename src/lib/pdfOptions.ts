import { pdfjs } from "react-pdf";

// Load the worker bundled with our single pdfjs-dist copy so the worker version
// always matches the API version react-pdf was built against.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// pdf.js decodes JPEG 2000 (JPX) images — common in scanned/research PDFs — with
// an OpenJPEG wasm module that it fetches by name from `wasmUrl`. Without this,
// every JPX-backed page silently fails to render (the document still "loads", so
// no error fires — the viewer just stays blank). The wasm files are copied from
// pdfjs-dist into public/wasm by the `sync-pdf-wasm` script (run on pre{dev,build})
// so they're served unhashed at a stable path. The trailing slash matters: pdf.js
// appends the file name (e.g. openjpeg.wasm) to this base.
const WASM_URL = `${import.meta.env.BASE_URL}wasm/`;

/**
 * Shared options for every `pdfjs.getDocument` call (directly and via react-pdf's
 * <Document options=...>). Centralised so the wasm/worker config can't drift
 * between the viewer and the page-height measurement pass.
 */
export const PDF_DOCUMENT_OPTIONS = {
  wasmUrl: WASM_URL,
} as const;
