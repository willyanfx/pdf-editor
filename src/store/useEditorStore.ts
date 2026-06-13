import { create } from "zustand";

/** Font families we can both render in the browser and embed on export. */
export type FontFamily = "Helvetica" | "Times" | "Courier";

export type TextEdit = {
  id: string;
  type: "text";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
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

export type PdfEdit =
  | TextEdit
  | {
      id: string;
      type: "image";
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
      dataUrl: string;
    }
  | {
      id: string;
      type: "rectangle";
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

/** Select vs. Edit-Text vs. OCR. In edit-text mode, clicking existing PDF text
 * turns it into an editable box. In ocr mode, dragging a rectangle runs OCR on
 * that region and turns recognized text into editable boxes. */
export type EditorMode = "select" | "editText" | "ocr";

type EditorState = {
  /** The source PDF. We keep the File (not a detachable ArrayBuffer) so we can
   * re-read fresh bytes for export — pdf.js transfers/neuters the buffer it
   * receives for rendering, so a shared ArrayBuffer would be empty by export time. */
  file: File | null;
  edits: PdfEdit[];
  selectedEditId: string | null;
  selectedPageIndex: number;
  /** Total page count of the open PDF (0 until loaded). Set by PdfViewer once
   * react-pdf reports it; read by the top bar for the page readout. */
  numPages: number;
  mode: EditorMode;

  /** OCR runs in a WASM worker and takes seconds; surface a global spinner. */
  ocrBusy: boolean;
  ocrProgress: number; // 0..1
  /** Set by the toolbar's "Extract Text" button to ask PdfViewer (which owns the
   * page canvases) to OCR a whole page. PdfViewer clears it after handling. */
  ocrRequestPageIndex: number | null;

  /** Registered by PdfViewer (which owns the virtualizer) so the top bar's
   * page nav can jump to a page even when that page isn't currently mounted.
   * scrollIntoView can't reach an unmounted page, so we route through here. */
  scrollToPage: ((pageIndex: number) => void) | null;

  setFile: (file: File) => void;
  addEdit: (edit: PdfEdit) => void;
  updateEdit: (id: string, patch: Partial<PdfEdit>) => void;
  deleteEdit: (id: string) => void;
  selectEdit: (id: string | null) => void;
  setSelectedPageIndex: (pageIndex: number) => void;
  setNumPages: (numPages: number) => void;
  setMode: (mode: EditorMode) => void;
  setOcrBusy: (busy: boolean) => void;
  setOcrProgress: (progress: number) => void;
  requestOcrPage: (pageIndex: number | null) => void;
  setScrollToPage: (fn: ((pageIndex: number) => void) | null) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  file: null,
  edits: [],
  selectedEditId: null,
  selectedPageIndex: 0,
  numPages: 0,
  mode: "select",
  ocrBusy: false,
  ocrProgress: 0,
  ocrRequestPageIndex: null,
  scrollToPage: null,

  setFile: (file) =>
    set({
      file,
      edits: [],
      selectedEditId: null,
      selectedPageIndex: 0,
      numPages: 0,
      mode: "select",
      ocrBusy: false,
      ocrProgress: 0,
      ocrRequestPageIndex: null,
    }),

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

  setNumPages: (numPages) => set({ numPages }),

  setMode: (mode) => set({ mode }),

  setOcrBusy: (ocrBusy) => set({ ocrBusy }),

  setOcrProgress: (ocrProgress) => set({ ocrProgress }),

  requestOcrPage: (ocrRequestPageIndex) => set({ ocrRequestPageIndex }),

  setScrollToPage: (scrollToPage) => set({ scrollToPage }),
}));

/** Shared default for newly-added text boxes. */
export function makeTextEdit(
  partial: Partial<TextEdit> & Pick<TextEdit, "pageIndex" | "x" | "y" | "width" | "height">,
): TextEdit {
  return {
    id: crypto.randomUUID(),
    type: "text",
    text: "Your text",
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

/** A recognized run of text (OCR or existing-PDF text) projected into screen px
 * at the viewer width, ready to become a text edit. Mirrors the OCR/textLayer
 * output shape so both sources share one edit-creation path. */
export type RecognizedTextRun = {
  str: string;
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
  return makeTextEdit({
    pageIndex,
    x: run.x,
    y: run.y,
    width: Math.max(run.width + 8, 40),
    height: Math.max(run.height, 16),
    text: run.str,
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
