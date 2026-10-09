import { create } from "zustand";

export type SidePanelTab = "pages" | "bookmarks" | "attachments" | "layers";

/**
 * UI-only state for the sidebar (its active view and the Bookmarks tree). Kept out of the editor store
 * on purpose: none of it is document data, so it isn't undoable or saved.
 */
type BookmarksUiState = {
  /** Which view the left sidebar shows. */
  tab: SidePanelTab;
  /** Ids of collapsed bookmarks (everything else is expanded). */
  collapsed: Record<string, true>;
  /** The bookmark the panel's toolbar acts on. */
  selectedId: string | null;
  /** The bookmark whose title is being edited inline. */
  renamingId: string | null;
  /** Bumped to ask the app to open the sidebar (e.g. after ⌘B). */
  openRequest: number;

  setTab: (tab: SidePanelTab) => void;
  toggleCollapsed: (id: string) => void;
  setCollapsed: (id: string, collapsed: boolean) => void;
  collapseAll: (ids: string[]) => void;
  expandAll: () => void;
  select: (id: string | null) => void;
  setRenaming: (id: string | null) => void;
  /** Open the sidebar on the Bookmarks view with `id` selected (optionally renaming). */
  reveal: (id: string | null, opts?: { rename?: boolean }) => void;
  /** Open the sidebar on `tab`. */
  showTab: (tab: SidePanelTab) => void;
};

export const useBookmarksUiStore = create<BookmarksUiState>()((set) => ({
  tab: "pages",
  collapsed: {},
  selectedId: null,
  renamingId: null,
  openRequest: 0,

  setTab: (tab) => set({ tab }),
  toggleCollapsed: (id) =>
    set((s) => {
      const collapsed = { ...s.collapsed };
      if (collapsed[id]) delete collapsed[id];
      else collapsed[id] = true;
      return { collapsed };
    }),
  setCollapsed: (id, value) =>
    set((s) => {
      if (!!s.collapsed[id] === value) return {};
      const collapsed = { ...s.collapsed };
      if (value) collapsed[id] = true;
      else delete collapsed[id];
      return { collapsed };
    }),
  collapseAll: (ids) => set({ collapsed: Object.fromEntries(ids.map((id) => [id, true])) }),
  expandAll: () => set({ collapsed: {} }),
  select: (selectedId) => set({ selectedId }),
  setRenaming: (renamingId) => set({ renamingId }),
  reveal: (id, opts = {}) =>
    set((s) => ({
      tab: "bookmarks",
      selectedId: id ?? s.selectedId,
      renamingId: opts.rename && id ? id : null,
      openRequest: s.openRequest + 1,
    })),
  showTab: (tab) => set((s) => ({ tab, openRequest: s.openRequest + 1 })),
}));
