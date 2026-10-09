/**
 * Glue between the download paths in useEditorActions and the redaction
 * pipeline: the one-time confirmation gate and the "redacted source" helper
 * for the paths that read the original file directly (split, merge, CSV).
 */
import { useEditorStore, type PdfEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { hasPendingRedactions, redactMarks } from "./redactGeometry";

/**
 * Resolves true when a download may proceed. The first time a document with
 * pending marks is downloaded, the explanation dialog (RedactConfirmDialog) is
 * shown and the result waits for the user's answer. No marks → always true.
 */
export function confirmRedactions(): Promise<boolean> {
  const state = useEditorStore.getState();
  const count = redactMarks(state.edits).length;
  if (count === 0 || state.redactConfirmed) return Promise.resolve(true);
  return new Promise((resolve) => {
    state.setRedactConfirm({
      count,
      resolve: (ok) => {
        const store = useEditorStore.getState();
        store.setRedactConfirm(null);
        if (ok) store.setRedactConfirmed(true);
        resolve(ok);
      },
    });
  });
}

/**
 * The document that split / merge / CSV export should read. Those paths have
 * always worked from the original file (no overlay edits, original page order),
 * so with no marks that's what they get; with marks they get the original with
 * ONLY its redactions applied, so nothing marked can leak through them.
 */
export async function redactedSourceFile(file: File, edits: PdfEdit[]): Promise<File> {
  if (!hasPendingRedactions(edits)) return file;
  const { exportRedactedPdf } = await import("./redact");
  const { bytes, warnings } = await exportRedactedPdf(file, redactMarks(edits));
  for (const w of warnings) useToastStore.getState().addToast(w, "info");
  return new File([bytes.slice()], file.name, { type: "application/pdf" });
}
