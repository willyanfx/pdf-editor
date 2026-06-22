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

/**
 * Load a PDF via pdf.js with the shared options AND password support, so direct
 * (non-viewer) paths — OCR, CSV export, page-height measurement, scanned
 * detection — can open the same encrypted document the viewer already unlocked.
 *
 * The password is read from the editor store. These background paths do NOT
 * prompt the user: the viewer's <Document> is the single prompt surface (see
 * makeViewerOnPassword). If the stored password is missing or rejected, the load
 * rejects with a PasswordException and the caller's existing error handling
 * applies — no duplicate modal, no race with the viewer's prompt.
 *
 * Returns the pdf.js loading task (call `.promise` for the document; remember to
 * `.destroy()` in a finally). `onPassword` is harmless on unencrypted PDFs (it's
 * never invoked).
 */
export async function loadPdfDocument(data: ArrayBuffer | Uint8Array) {
  const { pdfjs } = await import("react-pdf");
  const { makeOnPassword } = await import("./pdfPassword");
  const { useEditorStore } = await import("../store/useEditorStore");
  const onPassword = makeOnPassword({
    getPassword: () => useEditorStore.getState().documentPassword,
    // No onNeedPassword: stay silent and let the load reject if we have no
    // password — the viewer owns prompting.
    onIncorrect: () => {
      /* swallow: the viewer will surface the re-prompt */
    },
  });
  const loadingTask = pdfjs.getDocument({ data, ...PDF_DOCUMENT_OPTIONS });
  // pdf.js exposes onPassword on the loading task (not in the init params).
  loadingTask.onPassword = onPassword;
  return loadingTask;
}
