import { create } from "zustand";

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

  /** Set when a text edit is created from a click on existing text, so the newly
   * mounted editor can grab focus and drop the caret at the clicked character.
   * The editor consumes it once (clears it back to null). */
  pendingFocus: { editId: string; caretOffset: number } | null;

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
  setPendingFocus: (pf: { editId: string; caretOffset: number } | null) => void;
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
  pendingFocus: null,

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
      pendingFocus: null,
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
