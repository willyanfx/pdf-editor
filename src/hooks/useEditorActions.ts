import { useEditorStore, makeTextEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { addImageFromFile, openFiles, openConvertedFile } from "../lib/openFiles";

/** Callbacks the morphing Download button uses to drive its idle→spinner→check
 * animation; the export logic itself lives here so the rail, top bar, and
 * command palette all share one path. */
type DownloadHooks = {
  onStart?: () => void;
  onSuccess?: () => void;
  onError?: () => void;
};

/** Trigger a browser download of arbitrary PDF bytes under the given filename. */
function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Open a transient file picker; resolve with the chosen file(s). */
function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}

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
    void pickFiles("application/pdf").then((files) => {
      if (files[0]) openPdf(files[0]);
    });
  }

  /** Same, for an image/signature added onto an open PDF. */
  function pickImage() {
    if (!useEditorStore.getState().file) return;
    void pickFiles("image/png,image/jpeg").then((files) => {
      if (files[0]) {
        void addImageFromFile(files[0]).catch(() => {
          useToastStore.getState().addToast("Could not decode that image.", "error");
        });
      }
    });
  }

  /** Pick a non-PDF file (image/Word/Excel) and convert it into a new PDF. */
  function convertFile() {
    void pickFiles(
      // Lazy import keeps the accept string close to the converter.
      ".docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg",
    ).then(async (files) => {
      if (!files[0]) return;
      try {
        await openConvertedFile(files[0]);
      } catch {
        useToastStore.getState().addToast("Could not convert that file.", "error");
      }
    });
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

  /** OCR every page of the document (renders each off-screen in PdfViewer). */
  function extractAllPages() {
    const { file, ocrBusy, requestOcrAll } = useEditorStore.getState();
    if (!file || ocrBusy) return;
    requestOcrAll();
  }

  function setMode(mode: import("../store/useEditorStore").EditorMode) {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setMode(mode);
  }

  // --- Page transforms (rotate / crop) ----------------------------------

  function rotatePage(delta: number, pageIndex?: number) {
    const store = useEditorStore.getState();
    if (!store.file) return;
    const idx = pageIndex ?? store.selectedPageIndex;
    const current = store.pageOps.find((op) => op.pageIndex === idx)?.rotation ?? 0;
    store.setPageOp(idx, { rotation: current + delta });
  }

  function deletePage(pageIndex?: number) {
    const store = useEditorStore.getState();
    if (!store.file) return;
    const idx = pageIndex ?? store.selectedPageIndex;
    if (store.pageOrder.length <= 1) {
      useToastStore.getState().addToast("Can't delete the only page.", "error");
      return;
    }
    store.deletePage(idx);
    useToastStore.getState().addToast("Page removed from export", "info");
  }

  // --- Signature ---------------------------------------------------------

  function openSignature() {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setSignatureModalOpen(true);
  }

  // --- Find --------------------------------------------------------------

  function setSearch(query: string) {
    useEditorStore.getState().setSearchQuery(query);
  }

  // --- Export ------------------------------------------------------------

  /** Build export options from the current page order / transforms. */
  function exportOptions() {
    const { pageOrder, pageOps, numPages } = useEditorStore.getState();
    return {
      pageOrder: pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i),
      pageOps,
    };
  }

  async function downloadPdf(hooks: DownloadHooks = {}) {
    const { file, edits } = useEditorStore.getState();
    if (!file) return;

    hooks.onStart?.();
    try {
      const { exportEditedPdf } = await import("../lib/exportPdf");
      const bytes = await exportEditedPdf(file, edits, exportOptions());
      downloadBytes(bytes, file.name.replace(/\.pdf$/i, "") + ".edited.pdf");
      useToastStore.getState().addToast("PDF exported", "success");
      hooks.onSuccess?.();
    } catch {
      useToastStore.getState().addToast("Could not export this PDF.", "error");
      hooks.onError?.();
    }
  }

  /** Export the OCR/text edits as a formatted .docx (headings + bullet lists). */
  async function downloadDocx(hooks: DownloadHooks = {}) {
    const { file, edits, pageOrder, numPages } = useEditorStore.getState();
    if (!file) return;

    hooks.onStart?.();
    try {
      const { exportDocx } = await import("../lib/exportDocx");
      const order = pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i);
      const ok = await exportDocx(edits, file.name.replace(/\.pdf$/i, "") + ".docx", order);
      if (ok) {
        useToastStore.getState().addToast("DOCX exported", "success");
        hooks.onSuccess?.();
      } else {
        useToastStore.getState().addToast("No text to export — run OCR or add text first.", "info");
        hooks.onError?.();
      }
    } catch {
      useToastStore.getState().addToast("Could not export DOCX.", "error");
      hooks.onError?.();
    }
  }

  async function compressPdf(hooks: DownloadHooks = {}) {
    const { file, edits } = useEditorStore.getState();
    if (!file) return;

    hooks.onStart?.();
    try {
      const { compressEditedPdf } = await import("../lib/exportPdf");
      const bytes = await compressEditedPdf(file, edits, exportOptions());
      downloadBytes(bytes, file.name.replace(/\.pdf$/i, "") + ".compressed.pdf");
      useToastStore.getState().addToast("Compressed PDF exported", "success");
      hooks.onSuccess?.();
    } catch {
      useToastStore.getState().addToast("Could not compress this PDF.", "error");
      hooks.onError?.();
    }
  }

  /** Pick 2+ PDFs (plus the open one, if any) and download the merged result. */
  function mergePdfs() {
    void pickFiles("application/pdf", true).then(async (picked) => {
      const open = useEditorStore.getState().file;
      const files = open ? [open, ...picked] : picked;
      if (files.length < 2) {
        useToastStore.getState().addToast("Pick at least two PDFs to merge.", "error");
        return;
      }
      try {
        const { mergePdfs: merge } = await import("../lib/mergeSplitPdf");
        const bytes = await merge(files);
        downloadBytes(bytes, "merged.pdf");
        useToastStore.getState().addToast(`Merged ${files.length} PDFs`, "success");
      } catch {
        useToastStore.getState().addToast("Could not merge those PDFs.", "error");
      }
    });
  }

  /** Open the split-by-range dialog. */
  function openSplit() {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setSplitDialogOpen(true);
  }

  /** Split the open PDF by a range spec ("" → one file per page). */
  async function splitPdf(spec: string) {
    const { file } = useEditorStore.getState();
    if (!file) return;
    try {
      const { splitPdf: split } = await import("../lib/mergeSplitPdf");
      const parts = await split(file, spec);
      if (!parts.length) {
        useToastStore.getState().addToast("No pages matched that range.", "error");
        return;
      }
      const base = file.name.replace(/\.pdf$/i, "");
      for (const part of parts) downloadBytes(part.bytes, `${base}.${part.label}.pdf`);
      useToastStore.getState().addToast(`Split into ${parts.length} file(s)`, "success");
    } catch {
      useToastStore.getState().addToast("Could not split this PDF.", "error");
    }
  }

  return {
    openPdf,
    pickPdf,
    pickImage,
    convertFile,
    addText,
    addRectangle,
    extractText,
    extractAllPages,
    setMode,
    rotatePage,
    deletePage,
    openSignature,
    setSearch,
    openSplit,
    downloadPdf,
    downloadDocx,
    compressPdf,
    mergePdfs,
    splitPdf,
  };
}
