import { create } from "zustand";
import type { AttachmentEntry } from "../lib/attachments";
import type { LayerState } from "../lib/layers";
import type { PageLayout } from "../lib/pageLayout";
import { applyTheme, initialTheme, storeTheme, type Theme } from "../lib/theme";

/**
 * Viewing state that isn't document data: how pages are laid out, the color
 * theme, full screen, and what the open PDF carries (attachments, layers). Kept
 * out of the editor store on purpose — none of it is undoable, autosaved or
 * exported. Layout and theme are remembered between visits.
 */

const LAYOUT_KEY = "pdf-editor-view";

type SavedLayout = { pageLayout: PageLayout; coverPage: boolean };

function readSavedLayout(): SavedLayout {
  const fallback: SavedLayout = { pageLayout: "single", coverPage: false };
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedLayout>;
    return {
      pageLayout: parsed.pageLayout === "two" ? "two" : "single",
      coverPage: parsed.coverPage === true,
    };
  } catch {
    return fallback;
  }
}

function saveLayout(value: SavedLayout): void {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(value));
  } catch {
    // Not remembered; the session still works.
  }
}

type ViewerState = {
  theme: Theme;
  pageLayout: PageLayout;
  /** In two-page view, show the first page alone on the right. */
  coverPage: boolean;
  fullscreen: boolean;

  /** What the open PDF carries; cleared when the document changes. */
  attachments: AttachmentEntry[];
  /** Null when the document has no layers. */
  layers: LayerState | null;
  /** Bumped when layer visibility changes, so page canvases re-render. */
  layerVersion: number;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setPageLayout: (layout: PageLayout) => void;
  setCoverPage: (cover: boolean) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setAttachments: (attachments: AttachmentEntry[]) => void;
  setLayers: (layers: LayerState | null) => void;
  setLayerVisibility: (visibility: Record<string, boolean>) => void;
};

const saved = readSavedLayout();

export const useViewerStore = create<ViewerState>()((set, get) => ({
  theme: initialTheme(),
  pageLayout: saved.pageLayout,
  coverPage: saved.coverPage,
  fullscreen: false,
  attachments: [],
  layers: null,
  layerVersion: 0,

  setTheme: (theme) => {
    applyTheme(theme);
    storeTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  setPageLayout: (pageLayout) => {
    saveLayout({ pageLayout, coverPage: get().coverPage });
    set({ pageLayout });
  },
  setCoverPage: (coverPage) => {
    saveLayout({ pageLayout: get().pageLayout, coverPage });
    set({ coverPage });
  },
  setFullscreen: (fullscreen) => set({ fullscreen }),
  setAttachments: (attachments) => set({ attachments }),
  setLayers: (layers) => set({ layers }),
  setLayerVisibility: (visibility) =>
    set((s) => ({
      layers: s.layers ? { ...s.layers, visibility } : s.layers,
      layerVersion: s.layerVersion + 1,
    })),
}));

/** Put the saved/OS theme on <html>. Called once at startup, before first render. */
export function initTheme(): void {
  applyTheme(useViewerStore.getState().theme);
}
