import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OcrEngine } from "../lib/vlmOcr/types";
import type { InsertSource } from "../lib/pageInsert";
import {
  insertBookmark,
  moveBookmark as moveBookmarkInTree,
  moveBookmarkTo as moveBookmarkToInTree,
  removeBookmark,
  updateBookmark as updateBookmarkInTree,
  type Bookmark,
  type BookmarkDropPlace,
  type BookmarkMove,
} from "../lib/bookmarks";
import type { PDFDocument } from "pdf-lib";
import {
  createdPages,
  planDuplicate,
  planInsert,
  planReplace,
  remapPageState,
  removePagesFromState,
  type PagePlan,
} from "../lib/pageRemap";
import {
  EMPTY_PAGE_STAMPS,
  type HeaderFooterSettings,
  type PageStamps,
  type WatermarkSettings,
} from "../lib/pageStampsModel";
import {
  formValueEquals,
  type FormFieldSummary,
  type FormValue,
  type FormValues,
} from "../lib/formFields";
import { useToastStore } from "./useToastStore";

export type { InsertSource };

export type { OcrEngine };

export type { Bookmark };
export type { FormFieldSummary, FormValue, FormValues };

/** The undoable document state, as captured by snapshot(), plus whether the
 * file's own outline had been read when it was taken. Exposed so autosave can
 * persist/restore it without knowing which fields it contains. */
export type DocumentSnapshot = HistoryEntry & { outlineStatus?: "pending" | "ready" | "failed" };

/** A history snapshot. `file`/`numPages` are captured so insert/merge (which
 * swap the underlying File and grow the page count) fully revert on undo; for
 * ordinary edits they're unchanged, so restoring them is a no-op. */
type HistoryEntry = {
  edits: PdfEdit[];
  pageOps: PageOp[];
  pageOrder: number[];
  file: File | null;
  numPages: number;
  bookmarks: Bookmark[];
  pageStamps: PageStamps;
  formValues: FormValues;
};

/** Module-level coalesce tracker for updateEdit bursts (typing, arrow nudge). */
let lastCoalesce: { id: string; timestamp: number } | null = null;
const COALESCE_MS = 600;

/** Zoom bounds and step for the bottom-bar zoom controls. */
export const MIN_ZOOM = 0.5;
// 4x (not 3x) so fit-width on a wide monitor — which can resolve above 300% for
// a narrow page — isn't clipped by the clamp.
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.1;

/** Auto-fit zoom modes. null = a manual numeric zoom is in effect. */
export type ZoomPreset = "fit-width" | "fit-page" | null;

/** Clamp + round a zoom value to avoid float drift past the bounds. */
export const clampZoom = (z: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/** The three built-in PDF standard fonts (fast path — no download). */
export type StandardFontFamily = "Helvetica" | "Times" | "Courier";

/** Any font family string: standard fonts or a Google Font family name. */
export type FontFamily = string;

/** A styled span of text inside a TextEdit. Style fields are optional overrides;
 * when omitted, the run inherits the box-level value (fontSize/fontFamily/…).
 * A single-run box (the common case) carries one run with no overrides. */
export type TextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string; // hex; undefined → inherit box color
  fontSize?: number; // px; undefined → inherit box fontSize
  fontFamily?: FontFamily; // undefined → inherit box fontFamily
};

export type TextEdit = {
  id: string;
  type: "text";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The text content as styled runs. Box-level fontSize/fontFamily/bold/italic/
   * color below are the paragraph defaults each run inherits unless it overrides. */
  runs: TextRun[];
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string; // hex, e.g. "#111827"
  align: "left" | "center" | "right";
  /** "added" = brand-new box. "existing" = replaces text already in the PDF,
   * so on export we first paint a cover rectangle over the original glyphs. */
  origin: "added" | "existing";
  /** Fill color for the cover rectangle (sampled from the page). */
  coverColor: string;
  /** Original on-screen bbox of the covered text (existing-text edits only),
   * captured at lift time. The cover stays here even if the box is dragged. */
  coverRect?: { x: number; y: number; width: number; height: number };
};

export type ImageEdit = {
  id: string;
  type: "image";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  /** "added" = new overlay. "existing" = replaces an image already in the PDF,
   * so on export we first paint a cover rectangle over the original pixels. */
  origin?: "added" | "existing";
  /** Fill for the cover rectangle when replacing an existing PDF image. */
  coverColor?: string;
  /** Original on-screen bbox of the replaced image, locked at swap time. */
  coverRect?: { x: number; y: number; width: number; height: number };
};

/** Highlight / underline / strikeout — a rectangular text-markup annotation. */
export type MarkupEdit = {
  id: string;
  type: "highlight" | "underline" | "strikeout";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string; // hex
};

/** A sticky-note comment: a pin with attached text shown on hover/click. */
export type CommentEdit = {
  id: string;
  type: "comment";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string; // hex pin color
};

/** Freehand ink: a polyline in screen-px points relative to the page. */
export type InkEdit = {
  id: string;
  type: "ink";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Points relative to (x, y), in screen px at VIEWER_WIDTH. */
  points: { x: number; y: number }[];
  color: string; // hex
  strokeWidth: number;
};

/** A redaction mark. Unlike a cover rectangle it is not drawn over the page:
 * on download the marked area is permanently removed (page rasterized, content
 * under the mark blacked out, text/annotations/form fields dropped). See
 * lib/redact.ts. Rendered as a red outline (Acrobat convention) until then. */
export type RedactEdit = {
  id: string;
  type: "redact";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfEdit =
  | TextEdit
  | ImageEdit
  | {
      id: string;
      type: "rectangle";
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | MarkupEdit
  | CommentEdit
  | InkEdit
  | RedactEdit;

/** Per-page geometry mutation, kept separate from overlay edits so page
 * transforms survive independently. Insets/dimensions are in screen px at
 * VIEWER_WIDTH; export converts them to PDF user units. */
export type PageOp = {
  pageIndex: number;
  /** Clockwise rotation in degrees, normalized to a multiple of 90. */
  rotation: number;
  /** Crop insets from each edge, in screen px at VIEWER_WIDTH. */
  crop?: { top: number; right: number; bottom: number; left: number };
};

/** Select vs. Edit-Text vs. OCR. In edit-text mode, clicking existing PDF text
 * turns it into an editable box. In ocr mode, dragging a rectangle runs OCR on
 * that region and turns recognized text into editable boxes. In addText mode,
 * dragging (or clicking) places a new empty text box where the user draws it. */
export type EditorMode =
  | "select"
  | "editText"
  | "ocr"
  | "addText"
  | "highlight"
  | "underline"
  | "comment"
  | "ink"
  | "signZones"
  | "redact";

/** Where a signature image should be dropped, set by clicking an auto-detected
 * signature zone before opening the SignatureModal. Null = default placement. */
export type SignaturePlacement = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type EditorState = {
  /** The source PDF. We keep the File (not a detachable ArrayBuffer) so we can
   * re-read fresh bytes for export — pdf.js transfers/neuters the buffer it
   * receives for rendering, so a shared ArrayBuffer would be empty by export time. */
  file: File | null;
  edits: PdfEdit[];
  /** Per-page rotate/crop transforms, keyed by original page index. */
  pageOps: PageOp[];
  /** Display/export order of original page indices. Starts as [0..n-1].
   * Pages removed from this array are dropped from the export. */
  pageOrder: number[];
  selectedEditId: string | null;
  selectedPageIndex: number;
  /** Total page count of the open PDF (0 until loaded). Set by PdfViewer once
   * react-pdf reports it; read by the top bar for the page readout. */
  numPages: number;
  mode: EditorMode;

  /** Presentational zoom for the page stage. Pages always render at VIEWER_WIDTH
   * (so every stored edit/OCR coordinate stays in that space); zoom is applied as
   * a CSS transform on the page stage only. 1 = 100%. */
  zoom: number;
  /** When set, PdfViewer derives `zoom` from the live container size and keeps
   * it updated on resize. Any manual zoom (buttons / wheel / reset) clears it. */
  zoomPreset: ZoomPreset;

  /** Which OCR backend to run. "tesseract" is the default WASM engine; "florence2"
   * is the Transformers.js + WebGPU vision model that returns text with layout
   * boxes (and per-box font-size estimation). Persisted only in-session. */
  ocrEngine: OcrEngine;

  /** Non-null while the Florence-2 model is downloading/loading for the first
   * time after toggling to the AI engine. Distinct from ocrProgress (which tracks
   * recognition). Both the popover progress bar and the live toast read this. */
  ocrModelLoad: { fraction: number } | null;

  /** OCR runs in a WASM/GPU worker and takes seconds; surface a global spinner. */
  ocrBusy: boolean;
  ocrProgress: number; // 0..1
  /** Set by the toolbar's "Extract Text" button to ask PdfViewer (which owns the
   * page canvases) to OCR a whole page. PdfViewer clears it after handling. */
  ocrRequestPageIndex: number | null;
  /** Set true to ask PdfViewer to OCR EVERY page of the document. PdfViewer
   * renders each page off-screen and clears this when done or cancelled. */
  ocrAllRequest: boolean;
  /** Page-by-page progress for the whole-document run; null when not running. */
  ocrAllProgress: { current: number; total: number } | null;
  /** Flipped by cancelOcrAll() to abort the whole-document loop between pages. */
  ocrAllCancelled: boolean;

  /** Registered by PdfViewer (which owns the virtualizer) so the top bar's
   * page nav can jump to a page even when that page isn't currently mounted.
   * scrollIntoView can't reach an unmounted page, so we route through here. */
  scrollToPage: ((pageIndex: number) => void) | null;

  /** Set when a text edit is created from a click on existing text, so the newly
   * mounted editor can grab focus and drop the caret at the clicked character.
   * The editor consumes it once (clears it back to null). */
  pendingFocus: { editId: string; caretOffset: number } | null;

  /** Find-in-page: the active query and the ordered ids of matching text edits. */
  searchQuery: string;
  searchMatchIds: string[];

  /** The password used to decrypt the open PDF, once supplied. Held so direct
   * pdfjs.getDocument() paths (OCR, CSV, page-height, scanned-detection) can
   * unlock the same document the viewer already opened. Cleared on setFile. */
  documentPassword: string | null;
  /** Non-null while the unlock modal should be shown; `wrong` flags a retry after
   * an incorrect password. Set when an encrypted PDF needs/rejects a password. */
  passwordPrompt: { wrong: boolean } | null;
  /** Bumped each time the user submits a password, to re-key the viewer's
   * <Document> so react-pdf re-runs the load with the new stored password. */
  passwordAttempt: number;

  /** Whether the freehand/typed signature modal is open. */
  signatureModalOpen: boolean;
  /** Target zone for the next placed signature, or null for default placement.
   * Set by clicking an auto-detected signature zone; consumed + cleared by the
   * SignatureModal when it drops the image. */
  signaturePlacement: SignaturePlacement | null;
  /** Whether the split-by-range dialog is open. */
  splitDialogOpen: boolean;
  /** Whether the read-only document-properties (metadata) modal is open. */
  metadataModalOpen: boolean;
  /** Whether the open-from-URL dialog is open. */
  urlDialogOpen: boolean;
  /** Whether the compress-PDF dialog is open. */
  compressDialogOpen: boolean;
  setCompressDialogOpen: (open: boolean) => void;

  /** Bumped by every document mutation (history push, undo/redo, snapshot
   * restore). Reset to 0 by setFile. Drives autosave and the dirty flag. */
  revision: number;
  /** The `revision` at open or at the last successful download. The document is
   * dirty when revision !== savedRevision (see isDocumentDirty). */
  savedRevision: number;
  /** Record that the document is saved as of `revision` (default: right now). */
  markSaved: (revision?: number) => void;
  /** The document outline (bookmarks), page targets as ORIGINAL page indices.
   * Undoable document data; expand/collapse state is UI-only (not stored here). */
  bookmarks: Bookmark[];
  /** "pending" until the viewer has read the opened file's own outline; "ready"
   * once it has (bookmarks now reflect the file plus any edits); "failed" if the
   * outline couldn't be read. Editing is disabled while pending. A crash-restore
   * that sets `bookmarks` should also set this to "ready" so the file's original
   * outline doesn't replace the restored one. */
  outlineStatus: "pending" | "ready" | "failed";
  /** The outline exactly as read from the file (null until read). Export keeps
   * the file's own outline while `bookmarks` still equals it. Not undoable. */
  loadedBookmarks: Bookmark[] | null;
  /** Apply the outline read from `file` (null = reading failed). Ignored unless
   * `file` is still the open file and its outline hasn't been applied yet.
   * Does not create an undo step. */
  applyLoadedBookmarks: (file: File, bookmarks: Bookmark[] | null) => void;
  /** Insert a bookmark after `afterId` (as its sibling) or at a top-level index. */
  addBookmark: (
    bookmark: Bookmark,
    opts?: { afterId?: string | null; topLevelIndex?: number },
  ) => void;
  /** Rename and/or retarget a bookmark. */
  updateBookmark: (id: string, patch: Partial<Omit<Bookmark, "id" | "children">>) => void;
  /** Delete a bookmark and everything nested under it. */
  deleteBookmark: (id: string) => void;
  /** Move up/down among siblings, or indent/outdent one level. */
  moveBookmark: (id: string, move: BookmarkMove) => void;
  /** Drag-and-drop move relative to another bookmark. */
  moveBookmarkTo: (id: string, targetId: string, place: BookmarkDropPlace) => void;
  /** Document-level header/footer and watermark (each null when not applied). */
  pageStamps: PageStamps;
  /** Apply (or, with null, remove) the header/footer. One undo step. */
  setHeaderFooter: (settings: HeaderFooterSettings | null) => void;
  /** Apply (or, with null, remove) the watermark. One undo step. */
  setWatermark: (settings: WatermarkSettings | null) => void;
  /** AcroForm values the user entered, keyed by fully-qualified field name.
   * Only fields the user touched (or Reset form set) appear; anything absent
   * shows the document's own value. Undoable; baked in on export. */
  formValues: FormValues;
  /** The open document's fillable fields (derived by the viewer from pdf.js),
   * or null when it has none / hasn't been read yet. Not undoable. */
  formFields: FormFieldSummary[] | null;
  /** Set one field's value. Text typing passes coalesce=true so a burst of
   * keystrokes on the same field is one undo step (like updateEdit). */
  setFormValue: (name: string, value: FormValue, coalesce?: boolean) => void;
  /** Replace all form values in one undoable step (Reset form). */
  replaceFormValues: (values: FormValues) => void;
  setFormFields: (fields: FormFieldSummary[] | null) => void;
  /** Redaction UI state. The marks themselves are ordinary `redact` edits (so
   * they're undoable and autosaved); these flags are transient per-document UI. */
  /** Show redaction marks as solid black (what the download will look like)
   * instead of the red outlines used while marking. */
  redactPreviewSolid: boolean;
  /** Whether the "Search & redact" dialog is open. */
  redactSearchOpen: boolean;
  /** True once the user has acknowledged, for this document, that downloading
   * permanently removes the content under redaction marks. */
  redactConfirmed: boolean;
  /** A pending download waiting on that acknowledgement: `resolve(true)` lets the
   * download proceed, `resolve(false)` cancels it. Null when nothing is pending. */
  redactConfirm: { count: number; resolve: (ok: boolean) => void } | null;
  setRedactPreviewSolid: (solid: boolean) => void;
  setRedactSearchOpen: (open: boolean) => void;
  setRedactConfirmed: (confirmed: boolean) => void;
  setRedactConfirm: (pending: { count: number; resolve: (ok: boolean) => void } | null) => void;
  /** Add several edits as ONE undo step (e.g. all marks from a search). */
  addEdits: (edits: PdfEdit[]) => void;
  /** Delete several edits as ONE undo step. */
  deleteEdits: (ids: string[]) => void;

  /** History stacks — NOT in initialState so setFile does not reset them. */
  _past: HistoryEntry[];
  _future: HistoryEntry[];

  undo: () => void;
  redo: () => void;

  setFile: (file: File) => void;
  addEdit: (edit: PdfEdit) => void;
  updateEdit: (id: string, patch: Partial<PdfEdit>) => void;
  deleteEdit: (id: string) => void;
  selectEdit: (id: string | null) => void;
  setSelectedPageIndex: (pageIndex: number) => void;
  setNumPages: (numPages: number) => void;
  /** Set or merge a page's rotate/crop transform (by original page index). */
  setPageOp: (pageIndex: number, patch: Partial<Omit<PageOp, "pageIndex">>) => void;
  /** Replace the page display/export order. */
  setPageOrder: (order: number[]) => void;
  /** Remove a page from the export and drop its edits/transforms. */
  deletePage: (pageIndex: number) => void;
  setSearchQuery: (query: string) => void;
  setSignatureModalOpen: (open: boolean) => void;
  setSignaturePlacement: (placement: SignaturePlacement | null) => void;
  setDocumentPassword: (password: string | null) => void;
  setPasswordPrompt: (prompt: { wrong: boolean } | null) => void;
  /** Store the user's password, close the prompt, and re-key the viewer so the
   * encrypted document reloads with it. */
  submitPassword: (password: string) => void;
  setSplitDialogOpen: (open: boolean) => void;
  setMetadataModalOpen: (open: boolean) => void;
  setUrlDialogOpen: (open: boolean) => void;
  setMode: (mode: EditorMode) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Toggle an auto-fit mode. Passing the active preset turns it off (→ null). */
  setZoomPreset: (preset: ZoomPreset) => void;
  setOcrEngine: (engine: OcrEngine) => void;
  setOcrModelLoad: (load: { fraction: number } | null) => void;
  setOcrBusy: (busy: boolean) => void;
  setOcrProgress: (progress: number) => void;
  requestOcrPage: (pageIndex: number | null) => void;
  /** Start / clear a whole-document OCR run. */
  requestOcrAll: () => void;
  clearOcrAll: () => void;
  cancelOcrAll: () => void;
  setOcrAllProgress: (progress: { current: number; total: number } | null) => void;
  setScrollToPage: (fn: ((pageIndex: number) => void) | null) => void;
  setPendingFocus: (pf: { editId: string; caretOffset: number } | null) => void;
  /**
   * Splice pages from `sources` into the open document at visible slot `position`
   * (0 = before the first page in the current pageOrder, pageOrder.length = after
   * the last). Remaps all existing edits/pageOps/pageOrder so every reference still
   * points at the same visual page. The new File replaces the old one in state,
   * which causes PdfViewer's <Document> to reload with the updated bytes. Undo-able
   * via the normal history stack. No-ops if no file is open.
   */
  insertPages: (sources: InsertSource[], position: number) => Promise<void>;
  /** Rotate several pages by `delta` degrees as one undo step. */
  rotatePages: (pageIndices: number[], delta: number) => void;
  /** Remove several pages (and their edits/transforms) as one undo step. Refuses
   * to remove every visible page. */
  deletePages: (pageIndices: number[]) => void;
  /** Insert a real copy of each page right after it (rewrites the File; edits and
   * transforms are copied too). One undo step. Resolves to the new pages' indices,
   * or null if nothing changed. */
  duplicatePages: (pageIndices: number[]) => Promise<number[] | null>;
  /** Replace pages, in place, with `sourcePages` (0-based) of another PDF. Edits
   * and transforms on the replaced pages are dropped. One undo step. Resolves to
   * the new pages' indices, or null if nothing changed. */
  replacePages: (
    pageIndices: number[],
    source: File,
    sourcePages: number[],
  ) => Promise<number[] | null>;
};

/**
 * Per-document state, all at their fresh-document defaults. setFile() resets to
 * this on every open, so a new field added here is automatically cleared without
 * having to remember to also reset it in setFile(). `scrollToPage` is excluded —
 * it holds the live virtualizer callback wired up by PdfViewer, not document
 * data, so reloading a document must not clobber it.
 */
const initialState = {
  file: null as File | null,
  edits: [] as PdfEdit[],
  pageOps: [] as PageOp[],
  pageOrder: [] as number[],
  selectedEditId: null as string | null,
  selectedPageIndex: 0,
  numPages: 0,
  mode: "select" as EditorMode,
  zoom: 1,
  zoomPreset: null as ZoomPreset,
  ocrEngine: "tesseract" as OcrEngine,
  ocrModelLoad: null as { fraction: number } | null,
  ocrBusy: false,
  ocrProgress: 0,
  ocrRequestPageIndex: null as number | null,
  ocrAllRequest: false,
  ocrAllProgress: null as { current: number; total: number } | null,
  ocrAllCancelled: false,
  pendingFocus: null as { editId: string; caretOffset: number } | null,
  searchQuery: "",
  searchMatchIds: [] as string[],
  documentPassword: null as string | null,
  passwordPrompt: null as { wrong: boolean } | null,
  passwordAttempt: 0,
  signatureModalOpen: false,
  signaturePlacement: null as SignaturePlacement | null,
  splitDialogOpen: false,
  metadataModalOpen: false,
  urlDialogOpen: false,
  compressDialogOpen: false,
  revision: 0,
  savedRevision: 0,
  bookmarks: [] as Bookmark[],
  outlineStatus: "pending" as "pending" | "ready" | "failed",
  loadedBookmarks: null as Bookmark[] | null,
  pageStamps: EMPTY_PAGE_STAMPS as PageStamps,
  formValues: {} as FormValues,
  formFields: null as FormFieldSummary[] | null,
  redactPreviewSolid: false,
  redactSearchOpen: false,
  redactConfirmed: false,
  redactConfirm: null as { count: number; resolve: (ok: boolean) => void } | null,
};

/** Capture a snapshot of the mutable document arrays plus the file identity and
 * page count. Only the arrays are deep-cloned; the File is immutable so its
 * reference is kept as-is (cloning its bytes on every edit would be wasteful). */
function snapshot(state: {
  edits: PdfEdit[];
  pageOps: PageOp[];
  pageOrder: number[];
  file: File | null;
  numPages: number;
  bookmarks: Bookmark[];
  pageStamps: PageStamps;
  formValues: FormValues;
}): HistoryEntry {
  return {
    ...structuredClone({
      edits: state.edits,
      pageOps: state.pageOps,
      pageOrder: state.pageOrder,
      bookmarks: state.bookmarks,
      formValues: state.formValues,
    }),
    // Shared, not cloned: pageStamps is only ever replaced (the dialogs clone
    // their drafts), and a watermark image data URL can be megabytes.
    pageStamps: state.pageStamps,
    file: state.file,
    numPages: state.numPages,
  };
}

/**
 * Shared engine for page-structure operations that rewrite the File (insert,
 * duplicate, replace): builds the new bytes from a PagePlan, then commits the
 * File together with all page-indexed state — remapped by remapPageState, the
 * one place that knows every page-indexed field — as ONE history step.
 * Resolves to the committed plan, or null when nothing changed (no file, an
 * error — already toasted — or the document changed while bytes were built).
 */
async function rewritePages(
  makePlan: (baseCount: number, pageOrder: number[], extraCount: number) => PagePlan,
  loadExtra?: () => Promise<PDFDocument>,
): Promise<PagePlan | null> {
  const start = useEditorStore.getState();
  const { file } = start;
  if (!file) return null;
  try {
    const { loadPdf, buildPlannedPdf } = await import("../lib/pageOrganize");
    const [baseDoc, extra] = await Promise.all([loadPdf(file), loadExtra?.()]);
    const order = start.pageOrder.length ? start.pageOrder : baseDoc.getPageIndices();
    const plan = makePlan(baseDoc.getPageCount(), order, extra?.getPageCount() ?? 0);
    const bytes = await buildPlannedPdf(baseDoc, plan.layout, extra);
    // .slice() strips the generic ArrayBufferLike parameter File() rejects.
    const newFile = new File([bytes.slice()], file.name, { type: "application/pdf" });
    let committed = false;
    useEditorStore.setState((state) => {
      // The plan's indices describe the document as it was when we started.
      if (state.file !== file || state.pageOrder !== start.pageOrder) return {};
      committed = true;
      lastCoalesce = null;
      return {
        ...pushHistory(state, snapshot(state)),
        ...remapPageState(state, plan),
        file: newFile,
        numPages: plan.layout.length,
        selectedEditId: null,
      };
    });
    if (!committed) {
      useToastStore
        .getState()
        .addToast("The document changed while pages were being updated. Try again.", "error");
    }
    return committed ? plan : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not update the pages.";
    useToastStore.getState().addToast(msg, "error");
    return null;
  }
}

/** Push an entry onto _past, capping at 100 entries, and clear _future. Also
 * bumps `revision` so every history-recorded change marks the document dirty. */
function pushHistory(
  state: { _past: HistoryEntry[]; _future: HistoryEntry[]; revision: number },
  entry: HistoryEntry,
): { _past: HistoryEntry[]; _future: HistoryEntry[]; revision: number } {
  const past = state._past.length >= 100 ? state._past.slice(1) : state._past;
  return { _past: [...past, entry], _future: [], revision: state.revision + 1 };
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      ...initialState,
      scrollToPage: null,
      // History stacks live outside initialState so setFile does not reset them.
      _past: [],
      _future: [],

      // Clear history stacks explicitly on file open so undo doesn't bleed across docs.
      // Persisted settings (ocrEngine, zoom, zoomPreset) survive a file open — they're
      // user preferences, not per-document state — so they're re-applied after the reset.
      setFile: (file) =>
        set((state) => {
          lastCoalesce = null;
          return {
            ...initialState,
            file,
            _past: [],
            _future: [],
            ocrEngine: state.ocrEngine,
            zoom: state.zoom,
            zoomPreset: state.zoomPreset,
          };
        }),

      undo: () =>
        set((state) => {
          lastCoalesce = null;
          if (state._past.length === 0) return {};
          const entry = state._past[state._past.length - 1];
          const current = snapshot(state);
          return {
            edits: entry.edits,
            pageOps: entry.pageOps,
            pageOrder: entry.pageOrder,
            // file/numPages revert too, so undoing an insert/merge removes the
            // added pages and restores the page count (a no-op for plain edits).
            file: entry.file,
            numPages: entry.numPages,
            bookmarks: entry.bookmarks,
            pageStamps: entry.pageStamps,
            formValues: entry.formValues,
            selectedEditId: null,
            revision: state.revision + 1,
            _past: state._past.slice(0, -1),
            _future: [current, ...state._future],
          };
        }),

      redo: () =>
        set((state) => {
          lastCoalesce = null;
          if (state._future.length === 0) return {};
          const entry = state._future[0];
          const current = snapshot(state);
          return {
            edits: entry.edits,
            pageOps: entry.pageOps,
            pageOrder: entry.pageOrder,
            file: entry.file,
            numPages: entry.numPages,
            bookmarks: entry.bookmarks,
            pageStamps: entry.pageStamps,
            formValues: entry.formValues,
            selectedEditId: null,
            revision: state.revision + 1,
            _past: [...state._past, current],
            _future: state._future.slice(1),
          };
        }),

      addEdit: (edit) =>
        set((state) => {
          lastCoalesce = null;
          const hist = pushHistory(state, snapshot(state));
          return {
            ...hist,
            edits: [...state.edits, edit],
            selectedEditId: edit.id,
          };
        }),

      updateEdit: (id, patch) => {
        // Decide whether this update coalesces into the current burst. The decision
        // and the lastCoalesce mutation live OUTSIDE the set() updater: Zustand/React
        // may invoke updaters twice (StrictMode), so mutating module state in there
        // would corrupt coalesce timing.
        const now = Date.now();
        const coalesce =
          lastCoalesce !== null &&
          lastCoalesce.id === id &&
          now - lastCoalesce.timestamp < COALESCE_MS;
        lastCoalesce = { id, timestamp: now };
        set((state) => {
          const edits = state.edits.map((edit) =>
            edit.id === id ? ({ ...edit, ...patch } as PdfEdit) : edit,
          );
          // Coalescing keeps the existing burst's snapshot; otherwise capture one.
          return coalesce
            ? { edits, revision: state.revision + 1 }
            : { ...pushHistory(state, snapshot(state)), edits };
        });
      },

      deleteEdit: (id) =>
        set((state) => {
          lastCoalesce = null;
          const hist = pushHistory(state, snapshot(state));
          return {
            ...hist,
            edits: state.edits.filter((edit) => edit.id !== id),
            selectedEditId: state.selectedEditId === id ? null : state.selectedEditId,
          };
        }),

      markSaved: (revision) => set((state) => ({ savedRevision: revision ?? state.revision })),

      selectEdit: (id) => set({ selectedEditId: id }),

      setSelectedPageIndex: (pageIndex) => set({ selectedPageIndex: pageIndex }),

      setNumPages: (numPages) =>
        set((state) => ({
          numPages,
          // Seed the page order once the count is known (and only if not already set
          // for this document, so reorder/delete survive incidental re-reports —
          // including the reload after a page rewrite, where deleted pages leave
          // pageOrder shorter than the page count).
          pageOrder:
            state.pageOrder.length > 0 && state.pageOrder.every((i) => i < numPages)
              ? state.pageOrder
              : Array.from({ length: numPages }, (_, i) => i),
        })),

      setPageOp: (pageIndex, patch) =>
        set((state) => {
          lastCoalesce = null;
          const hist = pushHistory(state, snapshot(state));
          const existing = state.pageOps.find((op) => op.pageIndex === pageIndex);
          const next: PageOp = existing
            ? { ...existing, ...patch }
            : { pageIndex, rotation: 0, ...patch };
          return {
            ...hist,
            pageOps: [...state.pageOps.filter((op) => op.pageIndex !== pageIndex), next],
          };
        }),

      setPageOrder: (order) =>
        set((state) => {
          lastCoalesce = null;
          const hist = pushHistory(state, snapshot(state));
          return { ...hist, pageOrder: order };
        }),

      deletePage: (pageIndex) =>
        set((state) => {
          lastCoalesce = null;
          const hist = pushHistory(state, snapshot(state));
          return {
            ...hist,
            ...removePagesFromState(state, [pageIndex]),
            selectedEditId: null,
          };
        }),

      setSearchQuery: (searchQuery) =>
        set((state) => {
          const q = searchQuery.trim().toLowerCase();
          const matchIds = q
            ? state.edits
                .filter(
                  (e): e is TextEdit =>
                    e.type === "text" && runsToText(e.runs).toLowerCase().includes(q),
                )
                .map((e) => e.id)
            : [];
          return { searchQuery, searchMatchIds: matchIds };
        }),

      setSignatureModalOpen: (signatureModalOpen) => set({ signatureModalOpen }),
      setSignaturePlacement: (signaturePlacement) => set({ signaturePlacement }),
      setDocumentPassword: (documentPassword) => set({ documentPassword }),
      setPasswordPrompt: (passwordPrompt) => set({ passwordPrompt }),
      submitPassword: (password) =>
        set((state) => ({
          documentPassword: password,
          passwordPrompt: null,
          passwordAttempt: state.passwordAttempt + 1,
        })),

      setSplitDialogOpen: (splitDialogOpen) => set({ splitDialogOpen }),

      setMetadataModalOpen: (metadataModalOpen) => set({ metadataModalOpen }),

      setUrlDialogOpen: (urlDialogOpen) => set({ urlDialogOpen }),

      setCompressDialogOpen: (compressDialogOpen) => set({ compressDialogOpen }),

      setHeaderFooter: (headerFooter) =>
        set((state) => {
          lastCoalesce = null;
          return {
            ...pushHistory(state, snapshot(state)),
            pageStamps: { ...state.pageStamps, headerFooter },
          };
        }),

      setWatermark: (watermark) =>
        set((state) => {
          lastCoalesce = null;
          return {
            ...pushHistory(state, snapshot(state)),
            pageStamps: { ...state.pageStamps, watermark },
          };
        }),

      applyLoadedBookmarks: (file, bookmarks) =>
        set((state) => {
          // A newer file was opened, or this one's outline is already applied.
          if (state.file !== file || state.outlineStatus !== "pending") return {};
          if (bookmarks === null) return { outlineStatus: "failed" };
          // Bookmarks already present means they were restored from a saved
          // session; keep them rather than the file's original outline.
          if (state.bookmarks.length > 0) return { outlineStatus: "ready" };
          // The outline is part of the document as opened, so it must not be an
          // undo step. Editing is disabled while pending, so every history entry
          // recorded so far has no bookmarks; give them the loaded outline too,
          // otherwise undoing an early edit would wipe it.
          const withOutline = (entry: HistoryEntry) =>
            entry.file === file ? { ...entry, bookmarks } : entry;
          return {
            bookmarks,
            loadedBookmarks: bookmarks,
            outlineStatus: "ready",
            _past: state._past.map(withOutline),
            _future: state._future.map(withOutline),
          };
        }),

      addBookmark: (bookmark, opts) =>
        set((state) => {
          if (state.outlineStatus === "pending") return {};
          lastCoalesce = null;
          return {
            ...pushHistory(state, snapshot(state)),
            bookmarks: insertBookmark(state.bookmarks, bookmark, opts),
          };
        }),

      updateBookmark: (id, patch) =>
        set((state) => {
          lastCoalesce = null;
          return {
            ...pushHistory(state, snapshot(state)),
            bookmarks: updateBookmarkInTree(state.bookmarks, id, patch),
          };
        }),

      deleteBookmark: (id) =>
        set((state) => {
          lastCoalesce = null;
          return {
            ...pushHistory(state, snapshot(state)),
            bookmarks: removeBookmark(state.bookmarks, id),
          };
        }),

      moveBookmark: (id, move) =>
        set((state) => {
          const bookmarks = moveBookmarkInTree(state.bookmarks, id, move);
          if (bookmarks === state.bookmarks) return {}; // not possible: no undo step
          lastCoalesce = null;
          return { ...pushHistory(state, snapshot(state)), bookmarks };
        }),

      moveBookmarkTo: (id, targetId, place) =>
        set((state) => {
          const bookmarks = moveBookmarkToInTree(state.bookmarks, id, targetId, place);
          if (bookmarks === state.bookmarks) return {};
          lastCoalesce = null;
          return { ...pushHistory(state, snapshot(state)), bookmarks };
        }),
      setFormValue: (name, value, coalesceBurst = false) => {
        if (formValueEquals(useEditorStore.getState().formValues[name], value)) return;
        // Same coalescing scheme as updateEdit, keyed by a "form:" id so a field
        // name can never collide with an edit id.
        const key = `form:${name}`;
        const now = Date.now();
        const coalesce =
          coalesceBurst &&
          lastCoalesce !== null &&
          lastCoalesce.id === key &&
          now - lastCoalesce.timestamp < COALESCE_MS;
        lastCoalesce = coalesceBurst ? { id: key, timestamp: now } : null;
        set((state) => {
          const formValues = { ...state.formValues, [name]: value };
          // A coalesced keystroke adds no history entry but is still a change, so
          // it bumps `revision` (autosave + dirty flag), as updateEdit does.
          return coalesce
            ? { formValues, revision: state.revision + 1 }
            : { ...pushHistory(state, snapshot(state)), formValues };
        });
      },

      replaceFormValues: (values) =>
        set((state) => {
          lastCoalesce = null;
          return { ...pushHistory(state, snapshot(state)), formValues: values };
        }),

      setFormFields: (formFields) => set({ formFields }),

      setRedactPreviewSolid: (redactPreviewSolid) => set({ redactPreviewSolid }),
      setRedactSearchOpen: (redactSearchOpen) => set({ redactSearchOpen }),
      setRedactConfirmed: (redactConfirmed) => set({ redactConfirmed }),
      setRedactConfirm: (redactConfirm) => set({ redactConfirm }),

      addEdits: (newEdits) =>
        set((state) => {
          if (newEdits.length === 0) return {};
          lastCoalesce = null;
          const hist = pushHistory(state, snapshot(state));
          return { ...hist, edits: [...state.edits, ...newEdits], selectedEditId: null };
        }),

      deleteEdits: (ids) =>
        set((state) => {
          if (ids.length === 0) return {};
          lastCoalesce = null;
          const drop = new Set(ids);
          const hist = pushHistory(state, snapshot(state));
          return {
            ...hist,
            edits: state.edits.filter((edit) => !drop.has(edit.id)),
            selectedEditId:
              state.selectedEditId && drop.has(state.selectedEditId) ? null : state.selectedEditId,
          };
        }),

      setMode: (mode) => set({ mode }),

      // Manual zoom controls take over from any auto-fit mode, so they clear the
      // preset. The auto-fit path (PdfViewer's ResizeObserver) writes `zoom` via
      // setState directly so it can keep the derived value live without self-cancel.
      setZoom: (zoom) => set({ zoom: clampZoom(zoom), zoomPreset: null }),
      zoomIn: () => set((state) => ({ zoom: clampZoom(state.zoom + ZOOM_STEP), zoomPreset: null })),
      zoomOut: () =>
        set((state) => ({ zoom: clampZoom(state.zoom - ZOOM_STEP), zoomPreset: null })),
      resetZoom: () => set({ zoom: 1, zoomPreset: null }),
      setZoomPreset: (preset) =>
        set((state) => ({ zoomPreset: state.zoomPreset === preset ? null : preset })),

      setOcrEngine: (ocrEngine) => set({ ocrEngine }),
      setOcrModelLoad: (ocrModelLoad) => set({ ocrModelLoad }),
      setOcrBusy: (ocrBusy) => set({ ocrBusy }),

      setOcrProgress: (ocrProgress) => set({ ocrProgress }),

      requestOcrPage: (ocrRequestPageIndex) => set({ ocrRequestPageIndex }),
      requestOcrAll: () =>
        set({ ocrAllRequest: true, ocrAllCancelled: false, ocrAllProgress: null }),
      clearOcrAll: () =>
        set({ ocrAllRequest: false, ocrAllProgress: null, ocrAllCancelled: false }),
      cancelOcrAll: () => set({ ocrAllCancelled: true }),
      setOcrAllProgress: (ocrAllProgress) => set({ ocrAllProgress }),

      setScrollToPage: (scrollToPage) => set({ scrollToPage }),

      setPendingFocus: (pendingFocus) => set({ pendingFocus }),

      insertPages: async (sources, position) => {
        const plan = await rewritePages(
          (baseCount, order, extraCount) => planInsert(baseCount, order, position, extraCount),
          async () => (await import("../lib/pageInsert")).sourcesToDoc(sources),
        );
        const first = plan?.layout.findIndex((e) => e.kind === "new") ?? -1;
        if (first >= 0) set({ selectedPageIndex: first });
      },

      rotatePages: (pageIndices, delta) =>
        set((state) => {
          const targets = new Set(pageIndices);
          if (!targets.size) return {};
          lastCoalesce = null;
          const rotated = [...targets].map((pageIndex): PageOp => {
            const op = state.pageOps.find((o) => o.pageIndex === pageIndex);
            return op ? { ...op, rotation: op.rotation + delta } : { pageIndex, rotation: delta };
          });
          return {
            ...pushHistory(state, snapshot(state)),
            pageOps: [...state.pageOps.filter((op) => !targets.has(op.pageIndex)), ...rotated],
          };
        }),

      deletePages: (pageIndices) =>
        set((state) => {
          const drop = new Set(pageIndices);
          const remaining = state.pageOrder.filter((i) => !drop.has(i)).length;
          if (remaining === 0 || remaining === state.pageOrder.length) return {};
          lastCoalesce = null;
          return {
            ...pushHistory(state, snapshot(state)),
            ...removePagesFromState(state, drop),
            selectedEditId: null,
          };
        }),

      duplicatePages: async (pageIndices) => {
        const plan = await rewritePages((baseCount, order) =>
          planDuplicate(baseCount, order, pageIndices),
        );
        return plan && createdPages(plan);
      },

      replacePages: async (pageIndices, source, sourcePages) => {
        const plan = await rewritePages(
          (baseCount, order) => planReplace(baseCount, order, pageIndices, sourcePages),
          async () => (await import("../lib/pageOrganize")).loadPdf(source),
        );
        return plan && createdPages(plan);
      },
    }),
    {
      name: "pdf-editor:settings",
      // Persist only user preferences, never per-document or transient state.
      partialize: (state) => ({
        ocrEngine: state.ocrEngine,
        zoom: state.zoom,
        zoomPreset: state.zoomPreset,
      }),
    },
  ),
);

/** What autosave persists: exactly what snapshot() captures for undo. */
export function getDocumentSnapshot(): DocumentSnapshot {
  const state = useEditorStore.getState();
  return { ...snapshot(state), outlineStatus: state.outlineStatus };
}

/** Apply a snapshot (e.g. from crash recovery). No history entry; clears selection. */
export function restoreDocumentSnapshot(entry: DocumentSnapshot): void {
  lastCoalesce = null;
  // Spread the entry so any field a feature adds to snapshot()/HistoryEntry is
  // applied automatically (entry keys mirror state keys, as in undo()).
  const { outlineStatus, ...rest } = entry;
  // Snapshots without a status predate it: non-empty bookmarks can only come
  // from a read outline.
  const status = outlineStatus ?? (entry.bookmarks.length > 0 ? "ready" : "pending");
  // Taken before the file's outline was read, the snapshot's empty bookmarks
  // mean "unknown", not "all deleted": keep whatever the viewer has loaded (or
  // will load) instead of wiping the outline on the next download.
  const restored: Partial<EditorState> = { ...rest };
  if (status === "pending") delete restored.bookmarks;
  else restored.outlineStatus = status;
  useEditorStore.setState((state) => ({
    ...restored,
    selectedEditId: null,
    revision: state.revision + 1,
  }));
}

/** True when a document is open and has changed since it was opened or last
 * downloaded. Cheap: compares two counters. */
export function isDocumentDirty(
  state: Pick<EditorState, "file" | "revision" | "savedRevision"> = useEditorStore.getState(),
): boolean {
  return state.file !== null && state.revision !== state.savedRevision;
}

/** Flatten a runs array to a plain string. */
export function runsToText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join("");
}

/** Wrap a plain string as a single run, optionally carrying style overrides. */
export function textToRuns(text: string, patch: Partial<TextRun> = {}): TextRun[] {
  return [{ text, ...patch }];
}

/** Shared default for newly-added text boxes. */
export function makeTextEdit(
  partial: Partial<TextEdit> & Pick<TextEdit, "pageIndex" | "x" | "y" | "width" | "height">,
): TextEdit {
  return {
    id: crypto.randomUUID(),
    type: "text",
    runs: textToRuns("Your text"),
    fontSize: 18,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
    color: "#111827",
    align: "left",
    origin: "added",
    coverColor: "#ffffff",
    ...partial,
  };
}

/** Build an image edit that REPLACES an existing embedded PDF image: covers the
 * original pixels with a sampled color and draws the replacement on top. */
export function makeCoverImageEdit(
  rect: { x: number; y: number; width: number; height: number },
  pageIndex: number,
  dataUrl: string,
  coverColor: string,
): ImageEdit {
  return {
    id: crypto.randomUUID(),
    type: "image",
    pageIndex,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    dataUrl,
    origin: "existing",
    coverColor,
    coverRect: { ...rect },
  };
}

/** A recognized run of text (OCR or existing-PDF text) projected into screen px
 * at the viewer width, ready to become a text edit. Mirrors the OCR/textLayer
 * output shape so both sources share one edit-creation path. */
export type RecognizedTextRun = {
  str: string;
  /** Pre-formed styled runs (grouped existing-PDF text). When absent (OCR path,
   * which only has a plain `str`), makeCoverTextEdit derives a single run. */
  runs?: TextRun[];
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
};

/**
 * Build a text edit that REPLACES a recognized run: it covers the original
 * pixels (scanned glyphs / existing text) with a sampled background color and
 * draws editable replacement text on top. Used by OCR and the existing-text
 * lift flow so cover geometry stays defined in one place.
 */
export function makeCoverTextEdit(
  run: RecognizedTextRun,
  pageIndex: number,
  coverColor: string,
): TextEdit {
  // Prefer pre-formed runs (grouped existing text); otherwise derive a single
  // run from the plain `str` (OCR), carrying its bold/italic flags.
  const runs =
    run.runs ??
    textToRuns(run.str, { bold: run.bold || undefined, italic: run.italic || undefined });
  return makeTextEdit({
    pageIndex,
    x: run.x,
    y: run.y,
    width: Math.max(run.width + 8, 40),
    height: Math.max(run.height, 16),
    runs,
    fontSize: run.fontSize,
    fontFamily: run.fontFamily,
    bold: run.bold,
    italic: run.italic,
    color: "#111827",
    origin: "existing",
    coverColor,
    // Lock the cover to the original glyph box (padded to hide edges) so dragging
    // the replacement away doesn't re-expose the original.
    coverRect: {
      x: run.x - 2,
      y: run.y - 2,
      width: run.width + 4,
      height: run.height + 4,
    },
  });
}
