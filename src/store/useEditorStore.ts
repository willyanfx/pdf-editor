import { create } from "zustand";

export type PdfEdit =
  | {
      id: string;
      type: "text";
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      fontSize: number;
    }
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

type EditorState = {
  /** The source PDF. We keep the File (not a detachable ArrayBuffer) so we can
   * re-read fresh bytes for export — pdf.js transfers/neuters the buffer it
   * receives for rendering, so a shared ArrayBuffer would be empty by export time. */
  file: File | null;
  edits: PdfEdit[];
  selectedEditId: string | null;
  selectedPageIndex: number;

  setFile: (file: File) => void;
  addEdit: (edit: PdfEdit) => void;
  updateEdit: (id: string, patch: Partial<PdfEdit>) => void;
  deleteEdit: (id: string) => void;
  selectEdit: (id: string | null) => void;
  setSelectedPageIndex: (pageIndex: number) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  file: null,
  edits: [],
  selectedEditId: null,
  selectedPageIndex: 0,

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
      selectedEditId:
        state.selectedEditId === id ? null : state.selectedEditId,
    })),

  selectEdit: (id) => set({ selectedEditId: id }),

  setSelectedPageIndex: (pageIndex) => set({ selectedPageIndex: pageIndex }),
}));
