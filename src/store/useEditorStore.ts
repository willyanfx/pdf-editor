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

/** Select vs. Edit-Text. In edit-text mode, clicking existing PDF text turns
 * it into an editable box. */
export type EditorMode = "select" | "editText";

type EditorState = {
  /** The source PDF. We keep the File (not a detachable ArrayBuffer) so we can
   * re-read fresh bytes for export — pdf.js transfers/neuters the buffer it
   * receives for rendering, so a shared ArrayBuffer would be empty by export time. */
  file: File | null;
  edits: PdfEdit[];
  selectedEditId: string | null;
  selectedPageIndex: number;
  mode: EditorMode;

  setFile: (file: File) => void;
  addEdit: (edit: PdfEdit) => void;
  updateEdit: (id: string, patch: Partial<PdfEdit>) => void;
  deleteEdit: (id: string) => void;
  selectEdit: (id: string | null) => void;
  setSelectedPageIndex: (pageIndex: number) => void;
  setMode: (mode: EditorMode) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  file: null,
  edits: [],
  selectedEditId: null,
  selectedPageIndex: 0,
  mode: "select",

  setFile: (file) =>
    set({
      file,
      edits: [],
      selectedEditId: null,
      selectedPageIndex: 0,
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

  setMode: (mode) => set({ mode }),
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
