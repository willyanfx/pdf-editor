import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReviewStatus } from "./useEditorStore";
import { newCommentMeta, type AnnotationType } from "../lib/annotations";
import type { AnnotationMode } from "../lib/annotationExport";

export type CommentSort = "page" | "newest" | "oldest" | "author" | "type" | "status";

export type CommentFilters = {
  query: string;
  type: AnnotationType | "all";
  status: ReviewStatus | "all";
  /** An author name, or "all". */
  author: string;
  /** "current" = only the page being viewed. */
  page: "all" | "current";
};

export const NO_FILTERS: CommentFilters = {
  query: "",
  type: "all",
  status: "all",
  author: "all",
  page: "all",
};

/**
 * UI-only state for comments: who is commenting, how comments are written on
 * download, the armed stamp, and the Comments panel's filter/sort/expansion.
 * Not document data, so none of it is undoable or autosaved; the preferences
 * (author, export mode, stamp) persist across sessions.
 */
type CommentsUiState = {
  authorName: string;
  /** How a download treats comments: keep them as native PDF comments, or
   * flatten them into the page. */
  exportMode: AnnotationMode;
  /** Which stamp the stamp tool places (a STAMP_PRESETS id). */
  stampId: string;

  filters: CommentFilters;
  sort: CommentSort;
  /** The thread open in the panel. */
  expandedId: string | null;

  setAuthorName: (name: string) => void;
  setExportMode: (mode: AnnotationMode) => void;
  setStampId: (id: string) => void;
  setFilters: (patch: Partial<CommentFilters>) => void;
  clearFilters: () => void;
  setSort: (sort: CommentSort) => void;
  setExpandedId: (id: string | null) => void;
};

export const useCommentsUiStore = create<CommentsUiState>()(
  persist(
    (set) => ({
      authorName: "",
      exportMode: "flatten",
      stampId: "Approved",
      filters: NO_FILTERS,
      sort: "page",
      expandedId: null,

      setAuthorName: (authorName) => set({ authorName }),
      setExportMode: (exportMode) => set({ exportMode }),
      setStampId: (stampId) => set({ stampId }),
      setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
      clearFilters: () => set({ filters: NO_FILTERS }),
      setSort: (sort) => set({ sort }),
      setExpandedId: (expandedId) => set({ expandedId }),
    }),
    {
      name: "pdf-editor:comments",
      partialize: (s) => ({
        authorName: s.authorName,
        exportMode: s.exportMode,
        stampId: s.stampId,
      }),
    },
  ),
);

export const ANONYMOUS = "Anonymous";

/** The name stamped on new comments and replies. */
export function currentAuthor(): string {
  return useCommentsUiStore.getState().authorName.trim() || ANONYMOUS;
}

/** Author + timestamps for a mark the user is creating right now. */
export function newMarkMeta() {
  return newCommentMeta(currentAuthor());
}
