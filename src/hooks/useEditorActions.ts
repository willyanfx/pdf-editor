import { useEditorStore, makeTextEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { addImageFromFile, openFiles } from "../lib/openFiles";

/** Callbacks the morphing Download button uses to drive its idle→spinner→check
 * animation; the export logic itself lives here so the rail, top bar, and
 * command palette all share one path. */
type DownloadHooks = {
  onStart?: () => void;
  onSuccess?: () => void;
  onError?: () => void;
};

/**
 * The app's "verbs" in one place. Every action reads the store imperatively via
 * `getState()` at call time, so the returned object is stable and any component
 * (top bar, tool rail, command palette, keyboard handler) can invoke the same
 * handlers without prop-drilling.
 */
export function useEditorActions() {
  function openPdf(file: File) {
    openFiles([file]);
  }

  /** Open a transient file picker for a PDF. Used by the command palette, which
   * has no hidden <input> of its own. */
  function pickPdf() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = () => {
      const picked = input.files?.[0];
      if (picked) openPdf(picked);
    };
    input.click();
  }

  /** Same, for an image/signature added onto an open PDF. */
  function pickImage() {
    if (!useEditorStore.getState().file) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.onchange = () => {
      const picked = input.files?.[0];
      if (picked) {
        void addImageFromFile(picked).catch(() => {
          useToastStore.getState().addToast("Could not decode that image.", "error");
        });
      }
    };
    input.click();
  }

  function addText() {
    const { selectedPageIndex, addEdit } = useEditorStore.getState();
    addEdit(
      makeTextEdit({
        pageIndex: selectedPageIndex,
        x: 80,
        y: 80,
        width: 220,
        height: 60,
      }),
    );
  }

  function addRectangle() {
    const { selectedPageIndex, addEdit } = useEditorStore.getState();
    addEdit({
      id: crypto.randomUUID(),
      type: "rectangle",
      pageIndex: selectedPageIndex,
      x: 100,
      y: 120,
      width: 180,
      height: 80,
    });
  }

  function extractText() {
    const { file, ocrBusy, selectedPageIndex, requestOcrPage } = useEditorStore.getState();
    if (!file || ocrBusy) return;
    requestOcrPage(selectedPageIndex);
  }

  function setMode(mode: "select" | "editText" | "ocr") {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setMode(mode);
  }

  async function downloadPdf(hooks: DownloadHooks = {}) {
    const { file, edits } = useEditorStore.getState();
    if (!file) return;

    hooks.onStart?.();
    try {
      const { exportEditedPdf } = await import("../lib/exportPdf");
      const bytes = await exportEditedPdf(file, edits);
      // Copy into a fresh ArrayBuffer so the Blob owns standalone bytes.
      const blob = new Blob([bytes.slice()], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = file.name.replace(/\.pdf$/i, "") + ".edited.pdf";
      link.click();

      URL.revokeObjectURL(url);
      useToastStore.getState().addToast("PDF exported", "success");
      hooks.onSuccess?.();
    } catch {
      useToastStore.getState().addToast("Could not export this PDF.", "error");
      hooks.onError?.();
    }
  }

  return {
    openPdf,
    pickPdf,
    pickImage,
    addText,
    addRectangle,
    extractText,
    setMode,
    downloadPdf,
  };
}
