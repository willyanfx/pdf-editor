import { create } from "zustand";

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
  | InkEdit;

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
  | "ink";

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

  /** OCR runs in a WASM worker and takes seconds; surface a global spinner. */
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

  /** Whether the freehand/typed signature modal is open. */
  signatureModalOpen: boolean;
  /** Whether the split-by-range dialog is open. */
  splitDialogOpen: boolean;

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
  setSplitDialogOpen: (open: boolean) => void;
  setMode: (mode: EditorMode) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Toggle an auto-fit mode. Passing the active preset turns it off (→ null). */
  setZoomPreset: (preset: ZoomPreset) => void;
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
  ocrBusy: false,
  ocrProgress: 0,
  ocrRequestPageIndex: null as number | null,
  ocrAllRequest: false,
  ocrAllProgress: null as { current: number; total: number } | null,
  ocrAllCancelled: false,
  pendingFocus: null as { editId: string; caretOffset: number } | null,
  searchQuery: "",
  searchMatchIds: [] as string[],
  signatureModalOpen: false,
  splitDialogOpen: false,
};

export const useEditorStore = create<EditorState>((set) => ({
  ...initialState,
  scrollToPage: null,

  setFile: (file) => set({ ...initialState, file }),

  addEdit: (edit) =>
    set((state) => ({
      edits: [...state.edits, edit],
      selectedEditId: edit.id,
    })),

  updateEdit: (id, patch) =>
    set((state) => ({
      edits: state.edits.map((edit) =>
        edit.id === id ? ({ ...edit, ...patch } as PdfEdit) : edit,
      ),
    })),

  deleteEdit: (id) =>
    set((state) => ({
      edits: state.edits.filter((edit) => edit.id !== id),
      selectedEditId: state.selectedEditId === id ? null : state.selectedEditId,
    })),

  selectEdit: (id) => set({ selectedEditId: id }),

  setSelectedPageIndex: (pageIndex) => set({ selectedPageIndex: pageIndex }),

  setNumPages: (numPages) =>
    set((state) => ({
      numPages,
      // Seed the page order once the count is known (and only if not already set
      // for this document, so reorder/delete survive incidental re-reports).
      pageOrder:
        state.pageOrder.length === numPages
          ? state.pageOrder
          : Array.from({ length: numPages }, (_, i) => i),
    })),

  setPageOp: (pageIndex, patch) =>
    set((state) => {
      const existing = state.pageOps.find((op) => op.pageIndex === pageIndex);
      const next: PageOp = existing
        ? { ...existing, ...patch }
        : { pageIndex, rotation: 0, ...patch };
      return {
        pageOps: [...state.pageOps.filter((op) => op.pageIndex !== pageIndex), next],
      };
    }),

  setPageOrder: (order) => set({ pageOrder: order }),

  deletePage: (pageIndex) =>
    set((state) => ({
      pageOrder: state.pageOrder.filter((i) => i !== pageIndex),
      edits: state.edits.filter((e) => e.pageIndex !== pageIndex),
      pageOps: state.pageOps.filter((op) => op.pageIndex !== pageIndex),
      selectedEditId: null,
    })),

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

  setSplitDialogOpen: (splitDialogOpen) => set({ splitDialogOpen }),

  setMode: (mode) => set({ mode }),

  // Manual zoom controls take over from any auto-fit mode, so they clear the
  // preset. The auto-fit path (PdfViewer's ResizeObserver) writes `zoom` via
  // setState directly so it can keep the derived value live without self-cancel.
  setZoom: (zoom) => set({ zoom: clampZoom(zoom), zoomPreset: null }),
  zoomIn: () => set((state) => ({ zoom: clampZoom(state.zoom + ZOOM_STEP), zoomPreset: null })),
  zoomOut: () => set((state) => ({ zoom: clampZoom(state.zoom - ZOOM_STEP), zoomPreset: null })),
  resetZoom: () => set({ zoom: 1, zoomPreset: null }),
  setZoomPreset: (preset) =>
    set((state) => ({ zoomPreset: state.zoomPreset === preset ? null : preset })),

  setOcrBusy: (ocrBusy) => set({ ocrBusy }),

  setOcrProgress: (ocrProgress) => set({ ocrProgress }),

  requestOcrPage: (ocrRequestPageIndex) => set({ ocrRequestPageIndex }),
  requestOcrAll: () => set({ ocrAllRequest: true, ocrAllCancelled: false, ocrAllProgress: null }),
  clearOcrAll: () => set({ ocrAllRequest: false, ocrAllProgress: null, ocrAllCancelled: false }),
  cancelOcrAll: () => set({ ocrAllCancelled: true }),
  setOcrAllProgress: (ocrAllProgress) => set({ ocrAllProgress }),

  setScrollToPage: (scrollToPage) => set({ scrollToPage }),

  setPendingFocus: (pendingFocus) => set({ pendingFocus }),
}));

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
