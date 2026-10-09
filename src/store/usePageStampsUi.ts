import { create } from "zustand";
import {
  defaultHeaderFooter,
  defaultWatermark,
  HEADER_FOOTER_PRESETS,
  type HeaderFooterSettings,
  type WatermarkSettings,
} from "../lib/pageStampsModel";
import { useEditorStore } from "./useEditorStore";

export type PageStampsDialog = "headerFooter" | "watermark";

/**
 * Transient UI state for the header/footer and watermark dialogs: which one is
 * open and the draft being edited. Drafts are previewed live on the pages but
 * only reach the document (and undo history) when the dialog applies them, so
 * Cancel leaves the document untouched. Kept out of useEditorStore because it
 * is not document data and must never be snapshotted.
 */
type PageStampsUiState = {
  dialog: PageStampsDialog | null;
  headerFooterDraft: HeaderFooterSettings | null;
  watermarkDraft: WatermarkSettings | null;
  /** Open the header/footer dialog seeded from the document's current settings
   * (or defaults). `presetId` pre-fills one of HEADER_FOOTER_PRESETS. */
  openHeaderFooter: (presetId?: string) => void;
  openWatermark: () => void;
  setHeaderFooterDraft: (draft: HeaderFooterSettings) => void;
  setWatermarkDraft: (draft: WatermarkSettings) => void;
  close: () => void;
};

export const usePageStampsUi = create<PageStampsUiState>()((set) => ({
  dialog: null,
  headerFooterDraft: null,
  watermarkDraft: null,

  openHeaderFooter: (presetId) => {
    const current = useEditorStore.getState().pageStamps.headerFooter;
    const draft = current ? structuredClone(current) : defaultHeaderFooter();
    const preset = HEADER_FOOTER_PRESETS.find((p) => p.id === presetId);
    if (preset) draft.slots[preset.slot] = preset.text;
    set({ dialog: "headerFooter", headerFooterDraft: draft, watermarkDraft: null });
  },

  openWatermark: () => {
    const current = useEditorStore.getState().pageStamps.watermark;
    set({
      dialog: "watermark",
      watermarkDraft: current ? structuredClone(current) : defaultWatermark(),
      headerFooterDraft: null,
    });
  },

  setHeaderFooterDraft: (headerFooterDraft) => set({ headerFooterDraft }),
  setWatermarkDraft: (watermarkDraft) => set({ watermarkDraft }),
  close: () => set({ dialog: null, headerFooterDraft: null, watermarkDraft: null }),
}));
