import { create } from "zustand";
import { useEditorStore } from "./useEditorStore";

/**
 * Multi-page selection in the page panel, plus the open state of the dialogs
 * that act on it. Pure UI state: deliberately outside useEditorStore so it is
 * never snapshotted into undo history or autosave.
 */
type PageSelectionState = {
  /** Selected ORIGINAL page indices (same keys as pageOrder). Read them through
   * inVisibleOrder(pageOrder, selected): entries may briefly go stale after a
   * page is deleted. */
  selected: number[];
  /** Fixed end of a Shift-click range. */
  anchor: number | null;
  extractDialogOpen: boolean;
  replaceDialogOpen: boolean;
  setSelection: (selected: number[], anchor?: number | null) => void;
  clearSelection: () => void;
  setExtractDialogOpen: (open: boolean) => void;
  setReplaceDialogOpen: (open: boolean) => void;
};

export const usePageSelectionStore = create<PageSelectionState>()((set) => ({
  selected: [],
  anchor: null,
  extractDialogOpen: false,
  replaceDialogOpen: false,
  setSelection: (selected, anchor) =>
    set((s) => ({ selected, anchor: anchor === undefined ? s.anchor : anchor })),
  clearSelection: () => set({ selected: [], anchor: null }),
  setExtractDialogOpen: (extractDialogOpen) => set({ extractDialogOpen }),
  setReplaceDialogOpen: (replaceDialogOpen) => set({ replaceDialogOpen }),
}));

// Page indices only mean something for the File they were taken from. Opening
// a document, or any rewrite of it (insert/duplicate/replace and their
// undo/redo), invalidates them — so drop the selection. Actions that want to
// select the result set it again after their commit.
useEditorStore.subscribe((state, prev) => {
  if (state.file !== prev.file) {
    usePageSelectionStore.setState({
      selected: [],
      anchor: null,
      extractDialogOpen: false,
      replaceDialogOpen: false,
    });
  }
});
