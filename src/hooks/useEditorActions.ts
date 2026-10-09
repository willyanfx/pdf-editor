import { useEditorStore } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { addImageFromFile, openFiles, openConvertedFile, openPdfFromUrl } from "../lib/openFiles";
import { CONVERTIBLE_ACCEPT } from "../lib/convertToPdf";
import type { InsertSource } from "../lib/pageInsert";
import type { CompressOptions } from "../lib/compressPresets";
import { markDocumentSaved } from "../lib/autosave";
import { addBookmarkForCurrentPage, showBookmarks } from "../lib/bookmarkActions";
import { bookmarksForExport } from "../lib/bookmarks";
import { usePageSelectionStore } from "../store/usePageSelectionStore";
import { formatPageRanges, inVisibleOrder } from "../lib/pageRemap";
import { usePageStampsUi } from "../store/usePageStampsUi";
import { defaultFormValues } from "../lib/formFields";
import { confirmRedactions, redactedSourceFile } from "../lib/redactActions";
import { blankRedactedTextEdits, excludeRedactedTextEdits } from "../lib/redactGeometry";

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

/** Trigger a browser download of a text blob (e.g. CSV) under the given filename. */
function downloadText(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
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

  /** Open the "open from URL" dialog. */
  function openUrlDialog() {
    useEditorStore.getState().setUrlDialogOpen(true);
  }

  /** Fetch a PDF from a URL and open it, mapping failures to a clear toast. */
  async function openFromUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      await openPdfFromUrl(trimmed);
      useToastStore.getState().addToast("Opened PDF from URL", "success");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      const msg =
        reason === "network-or-cors"
          ? "Couldn't fetch that URL (blocked by CORS?). Try downloading it and opening the file."
          : reason === "not-a-pdf"
            ? "That URL doesn't point to a PDF."
            : reason.startsWith("http-")
              ? `Server returned ${reason.replace("http-", "HTTP ")}.`
              : "Could not open that URL.";
      useToastStore.getState().addToast(msg, "error");
      throw err; // let the dialog keep itself open on failure
    }
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

  /** Pick a non-PDF file (image/Word/Excel/HEIC/HTML) and convert it into a new PDF. */
  function convertFile() {
    void pickFiles(CONVERTIBLE_ACCEPT).then(async (files) => {
      if (!files[0]) return;
      try {
        await openConvertedFile(files[0]);
      } catch {
        useToastStore.getState().addToast("Could not convert that file.", "error");
      }
    });
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

  /** Build export options from the current page order / transforms, or for
   * just `pages` (original indices, in output order) when given. */
  function exportOptions(pages?: number[]) {
    const state = useEditorStore.getState();
    const { pageOrder, pageOps, numPages, pageStamps, formValues } = state;
    const order =
      pages ?? (pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i));
    return {
      pageOrder: order,
      pageOps,
      bookmarks: bookmarksForExport(state, order),
      pageStamps,
      formValues,
    };
  }

  async function downloadPdf(hooks: DownloadHooks = {}, opts: { flattenForms?: boolean } = {}) {
    const { file, edits, revision } = useEditorStore.getState();
    if (!file) return;
    // Pending redaction marks: explain once (per document) what the download
    // will contain and let the user back out before any work starts.
    if (!(await confirmRedactions())) return;

    hooks.onStart?.();
    try {
      // exportRedactedPdf = exportEditedPdf + the redaction pass (a no-op
      // without marks). exportEditedPdf alone refuses pending marks.
      const { exportRedactedPdf } = await import("../lib/redact");
      const { bytes, warnings } = await exportRedactedPdf(file, edits, {
        ...exportOptions(),
        ...opts,
      });
      for (const w of warnings) useToastStore.getState().addToast(w, "info");
      downloadBytes(bytes, file.name.replace(/\.pdf$/i, "") + ".edited.pdf");
      markDocumentSaved(revision);
      useToastStore.getState().addToast("PDF exported", "success");
      hooks.onSuccess?.();
    } catch {
      useToastStore.getState().addToast("Could not export this PDF.", "error");
      hooks.onError?.();
    }
  }

  /** Download with every form field drawn into the page (no longer fillable). */
  function downloadPdfFlattened(hooks: DownloadHooks = {}) {
    return downloadPdf(hooks, { flattenForms: true });
  }

  /** Put every fillable field back to the document's default value (undoable). */
  function resetForm() {
    const { formFields, replaceFormValues } = useEditorStore.getState();
    if (!formFields?.length) {
      useToastStore.getState().addToast("This PDF has no form to reset.", "info");
      return;
    }
    replaceFormValues(defaultFormValues(formFields));
    useToastStore.getState().addToast("Form reset", "info");
  }

  /** Export the OCR/text edits as a formatted .docx (headings + bullet lists). */
  async function downloadDocx(hooks: DownloadHooks = {}) {
    const { file, edits, pageOrder, numPages } = useEditorStore.getState();
    if (!file) return;

    hooks.onStart?.();
    try {
      const { exportDocx } = await import("../lib/exportDocx");
      const order = pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i);
      // Text boxes touched by a redaction mark are left out entirely.
      const ok = await exportDocx(
        excludeRedactedTextEdits(edits),
        file.name.replace(/\.pdf$/i, "") + ".docx",
        order,
      );
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

  /** Export the PDF's native (selectable) text as a CSV (Page, Line, Text). */
  async function downloadCsv(hooks: DownloadHooks = {}) {
    const { file, edits } = useEditorStore.getState();
    if (!file) return;

    hooks.onStart?.();
    try {
      const { buildCsv } = await import("../lib/exportCsv");
      // With redaction marks pending, read the text of the redacted document.
      const csv = await buildCsv(await redactedSourceFile(file, edits));
      if (!csv) {
        useToastStore
          .getState()
          .addToast("No selectable text found — run OCR for scanned PDFs.", "info");
        hooks.onError?.();
        return;
      }
      downloadText(csv, file.name.replace(/\.pdf$/i, "") + ".csv", "text/csv");
      useToastStore.getState().addToast("CSV exported", "success");
      hooks.onSuccess?.();
    } catch {
      useToastStore.getState().addToast("Could not export CSV.", "error");
      hooks.onError?.();
    }
  }

  async function compressPdf(hooks: DownloadHooks = {}, compressOptions?: CompressOptions) {
    const { file, edits, revision } = useEditorStore.getState();
    if (!file) return;
    if (!(await confirmRedactions())) return;

    hooks.onStart?.();
    try {
      const { compressEditedPdf } = await import("../lib/exportPdf");
      const { createRedactionPass } = await import("../lib/redact");
      // Redaction runs on the baked bytes BEFORE compression, so the flattened
      // pages are what gets compressed (null when there are no marks).
      const options = exportOptions();
      const pass = createRedactionPass(file, edits, options.pageOrder);
      const bytes = await compressEditedPdf(
        file,
        blankRedactedTextEdits(edits),
        { ...options, redactionsHandled: true },
        compressOptions,
        pass?.run,
      );
      for (const w of pass?.warnings ?? []) useToastStore.getState().addToast(w, "info");
      downloadBytes(bytes, file.name.replace(/\.pdf$/i, "") + ".compressed.pdf");
      markDocumentSaved(revision);
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
      const { file: open, edits } = useEditorStore.getState();
      const files = open ? [open, ...picked] : picked;
      if (files.length < 2) {
        useToastStore.getState().addToast("Pick at least two PDFs to merge.", "error");
        return;
      }
      if (open && !(await confirmRedactions())) return;
      try {
        const { mergePdfs: merge } = await import("../lib/mergeSplitPdf");
        // The open document contributes its redacted form when marks are pending.
        if (open) files[0] = await redactedSourceFile(open, edits);
        const bytes = await merge(files);
        downloadBytes(bytes, "merged.pdf");
        useToastStore.getState().addToast(`Merged ${files.length} PDFs`, "success");
      } catch {
        useToastStore.getState().addToast("Could not merge those PDFs.", "error");
      }
    });
  }

  /**
   * Pick one or more PDF/image/Office files and insert them at the end of the
   * current document (position = pageOrder.length). Used by the command palette
   * and tool-rail "Add pages" entry so users don't have to hover a gap.
   */
  function addPages() {
    void pickFiles("application/pdf," + CONVERTIBLE_ACCEPT, true).then(async (files) => {
      if (!files.length) return;
      const store = useEditorStore.getState();
      if (!store.file || !store.insertPages) return;
      const sources: InsertSource[] = files.map((file) =>
        file.type === "application/pdf"
          ? { kind: "pdf" as const, file }
          : { kind: "convert" as const, file },
      );
      try {
        await store.insertPages(sources, store.pageOrder.length);
        useToastStore.getState().addToast("Pages inserted", "success");
      } catch {
        useToastStore.getState().addToast("Could not insert pages.", "error");
      }
    });
  }

  /** Open the split-by-range dialog. */
  function openSplit() {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setSplitDialogOpen(true);
  }

  /** Open the compare-two-PDFs dialog (works with or without an open document). */
  function openCompare() {
    useEditorStore.getState().setCompareDialogOpen(true);
  }

  /** Open the read-only document-properties (metadata) modal. */
  function openMetadata() {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setMetadataModalOpen(true);
  }

  /** Open the compress-PDF dialog. */
  function openCompressDialog() {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setCompressDialogOpen(true);
  }

  /** Open the header & footer dialog; `presetId` (see HEADER_FOOTER_PRESETS,
   * e.g. "page-of" or "bates") pre-fills a slot. */
  function openHeaderFooter(presetId?: string) {
    if (!useEditorStore.getState().file) return;
    usePageStampsUi.getState().openHeaderFooter(presetId);
  }

  /** Open the watermark dialog. */
  function openWatermark() {
    if (!useEditorStore.getState().file) return;
    usePageStampsUi.getState().openWatermark();
  }

  /**
   * Split the open PDF. `mode` "ranges" parses the spec ("" → one file per page);
   * "interval" emits one file per `chunkSize` consecutive pages.
   */
  async function splitPdf(
    options: { mode: "ranges"; spec: string } | { mode: "interval"; chunkSize: number },
  ) {
    const { file, numPages, edits } = useEditorStore.getState();
    if (!file) return;
    if (!(await confirmRedactions())) return;
    try {
      const {
        splitPdf: split,
        parsePageRanges,
        chunkRanges,
      } = await import("../lib/mergeSplitPdf");
      const groups =
        options.mode === "interval"
          ? chunkRanges(numPages, options.chunkSize)
          : options.spec.trim().length > 0
            ? parsePageRanges(options.spec, numPages)
            : undefined; // empty ranges spec → one file per page (split's default)
      // Split the redacted document when marks are pending (original otherwise).
      const parts = await split(await redactedSourceFile(file, edits), groups);
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

  // --- Page selection (page panel multi-select) ---------------------------

  /** The selected pages in visible order, or the current page when nothing is
   * selected — every selection action falls back to the page in view. */
  function targetPages(): number[] {
    const { pageOrder, selectedPageIndex } = useEditorStore.getState();
    const selected = inVisibleOrder(pageOrder, usePageSelectionStore.getState().selected);
    if (selected.length) return selected;
    return pageOrder.includes(selectedPageIndex) ? [selectedPageIndex] : [];
  }

  function selectAllPages() {
    const { pageOrder } = useEditorStore.getState();
    usePageSelectionStore.getState().setSelection([...pageOrder], pageOrder[0] ?? null);
  }

  function rotateSelectedPages(delta: number) {
    const pages = targetPages();
    if (pages.length) useEditorStore.getState().rotatePages(pages, delta);
  }

  function deleteSelectedPages() {
    const pages = targetPages();
    if (!pages.length) return;
    if (pages.length >= useEditorStore.getState().pageOrder.length) {
      useToastStore.getState().addToast("Can't delete every page.", "error");
      return;
    }
    useEditorStore.getState().deletePages(pages);
    usePageSelectionStore.getState().clearSelection();
    useToastStore
      .getState()
      .addToast(pages.length === 1 ? "Page deleted" : `${pages.length} pages deleted`, "info");
  }

  async function duplicateSelectedPages() {
    const pages = targetPages();
    if (!pages.length) return;
    const created = await useEditorStore.getState().duplicatePages(pages);
    if (!created) return;
    usePageSelectionStore.getState().setSelection(created, created[0]);
    useToastStore
      .getState()
      .addToast(
        pages.length === 1 ? "Page duplicated" : `${pages.length} pages duplicated`,
        "success",
      );
  }

  /** Insert one blank page right after the last selected (or current) page. */
  async function insertBlankAfterSelection() {
    const pages = targetPages();
    const store = useEditorStore.getState();
    if (!store.file) return;
    const after = pages.length ? store.pageOrder.indexOf(pages[pages.length - 1]) + 1 : 0;
    await store.insertPages([{ kind: "blank", size: "letter" }], after);
    const created = useEditorStore.getState().pageOrder[after];
    if (useEditorStore.getState().file !== store.file && created !== undefined) {
      usePageSelectionStore.getState().setSelection([created], created);
      useToastStore.getState().addToast("Blank page added", "success");
    }
  }

  function openExtractDialog() {
    if (!useEditorStore.getState().file || !targetPages().length) return;
    usePageSelectionStore.getState().setExtractDialogOpen(true);
  }

  function openReplaceDialog() {
    if (!useEditorStore.getState().file || !targetPages().length) return;
    usePageSelectionStore.getState().setReplaceDialogOpen(true);
  }

  /** Download the target pages (visible order, edits baked) as a new PDF, then
   * optionally remove them from this document. */
  async function extractSelectedPages(deleteAfter = false) {
    const pages = targetPages();
    const { file, edits, pageOrder } = useEditorStore.getState();
    if (!file || !pages.length) return;
    // Extracted pages carry the same edits as a full download, so pending
    // redaction marks must be applied (and confirmed) here too.
    if (!(await confirmRedactions())) return;
    try {
      const { exportRedactedPdf } = await import("../lib/redact");
      const { bytes, warnings } = await exportRedactedPdf(file, edits, exportOptions(pages));
      for (const w of warnings) useToastStore.getState().addToast(w, "info");
      const numbers = pages.map((p) => pageOrder.indexOf(p) + 1);
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBytes(bytes, `${base}-pages-${formatPageRanges(numbers)}.pdf`);
    } catch {
      useToastStore.getState().addToast("Could not extract those pages.", "error");
      return;
    }
    const removed = deleteAfter && pages.length < pageOrder.length;
    if (removed) {
      useEditorStore.getState().deletePages(pages);
      usePageSelectionStore.getState().clearSelection();
    }
    const what = pages.length === 1 ? "Page" : `${pages.length} pages`;
    useToastStore
      .getState()
      .addToast(removed ? `${what} extracted and removed` : `${what} extracted`, "success");
  }

  /** Replace the target pages with `sourcePages` (0-based) of `source`. */
  async function replaceSelectedPages(source: File, sourcePages: number[]) {
    const pages = targetPages();
    if (!pages.length || !sourcePages.length) return;
    const created = await useEditorStore.getState().replacePages(pages, source, sourcePages);
    if (!created) return;
    usePageSelectionStore.getState().setSelection(created, created[0]);
    useToastStore
      .getState()
      .addToast(pages.length === 1 ? "Page replaced" : `${pages.length} pages replaced`, "success");
  }

  // --- Redaction ----------------------------------------------------------

  /** Open the "Search & redact" dialog. */
  function openRedactSearch() {
    if (!useEditorStore.getState().file) return;
    useEditorStore.getState().setRedactSearchOpen(true);
  }

  /** Toggle the solid-black preview of redaction marks. */
  function toggleRedactPreview() {
    const store = useEditorStore.getState();
    store.setRedactPreviewSolid(!store.redactPreviewSolid);
  }

  /** Remove every pending redaction mark (one undo step). */
  function clearRedactions() {
    const store = useEditorStore.getState();
    const ids = store.edits.filter((e) => e.type === "redact").map((e) => e.id);
    if (ids.length === 0) return;
    store.deleteEdits(ids);
    useToastStore.getState().addToast("Redaction marks removed", "info");
  }

  return {
    openPdf,
    pickPdf,
    openRedactSearch,
    toggleRedactPreview,
    clearRedactions,
    openUrlDialog,
    openFromUrl,
    pickImage,
    convertFile,
    addRectangle,
    extractText,
    extractAllPages,
    setMode,
    rotatePage,
    deletePage,
    openSignature,
    setSearch,
    openSplit,
    openCompare,
    openMetadata,
    openCompressDialog,
    openHeaderFooter,
    openWatermark,
    downloadPdf,
    downloadPdfFlattened,
    resetForm,
    downloadDocx,
    downloadCsv,
    compressPdf,
    mergePdfs,
    splitPdf,
    addPages,
    addBookmark: addBookmarkForCurrentPage,
    showBookmarks,
    targetPages,
    selectAllPages,
    rotateSelectedPages,
    deleteSelectedPages,
    duplicateSelectedPages,
    insertBlankAfterSelection,
    openExtractDialog,
    openReplaceDialog,
    extractSelectedPages,
    replaceSelectedPages,
  };
}
