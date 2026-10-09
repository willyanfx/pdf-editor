import { create } from "zustand";

export type ExportToolsDialog = "pageImages" | "embeddedImages" | "sanitize";

/**
 * Which of the image-export / sanitize dialogs is open. Pure UI state, kept out
 * of useEditorStore so it is never snapshotted into undo history or autosave.
 */
type ExportToolsUiState = {
  dialog: ExportToolsDialog | null;
  open: (dialog: ExportToolsDialog) => void;
  close: () => void;
};

export const useExportToolsUi = create<ExportToolsUiState>()((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));
