import { ANNOTATION_LABEL, STATUS_LABEL, statusOf, type AnnotationEdit } from "./annotations";
import type { CommentFilters, CommentSort } from "../store/useCommentsUiStore";

/*
 * Pure filtering and sorting for the Comments panel, kept out of the component
 * so it can be unit-tested without React.
 */

/** Lower-cased text the search box matches against: note, author, type, status,
 * stamp label, and every reply's author and text. */
function searchText(edit: AnnotationEdit): string {
  const parts = [
    edit.text,
    edit.author,
    ANNOTATION_LABEL[edit.type],
    STATUS_LABEL[statusOf(edit)],
    edit.type === "stamp" ? edit.label : undefined,
    ...(edit.replies ?? []).flatMap((r) => [r.author, r.text]),
  ];
  return parts.filter(Boolean).join("\n").toLowerCase();
}

export function filterComments(
  edits: AnnotationEdit[],
  filters: CommentFilters,
  currentPage: number,
): AnnotationEdit[] {
  const query = filters.query.trim().toLowerCase();
  return edits.filter((e) => {
    if (filters.type !== "all" && e.type !== filters.type) return false;
    if (filters.status !== "all" && statusOf(e) !== filters.status) return false;
    if (filters.author !== "all" && (e.author ?? "") !== filters.author) return false;
    if (filters.page === "current" && e.pageIndex !== currentPage) return false;
    if (query && !searchText(e).includes(query)) return false;
    return true;
  });
}

/** Visible position of a page (the number the page panel shows); pages missing
 * from the order sort last. */
function pageRank(pageOrder: number[] | undefined, pageIndex: number): number {
  if (!pageOrder?.length) return pageIndex;
  const pos = pageOrder.indexOf(pageIndex);
  return pos < 0 ? pageOrder.length + pageIndex : pos;
}

const STATUS_RANK = { none: 0, accepted: 1, completed: 2, rejected: 3, cancelled: 4 } as const;

export function sortComments(
  edits: AnnotationEdit[],
  sort: CommentSort,
  pageOrder?: number[],
): AnnotationEdit[] {
  // Reading order: visible page, then top to bottom, then left to right.
  const byPosition = (a: AnnotationEdit, b: AnnotationEdit) =>
    pageRank(pageOrder, a.pageIndex) - pageRank(pageOrder, b.pageIndex) || a.y - b.y || a.x - b.x;
  const time = (e: AnnotationEdit) => e.createdAt ?? 0;
  const by: Record<CommentSort, (a: AnnotationEdit, b: AnnotationEdit) => number> = {
    page: byPosition,
    newest: (a, b) => time(b) - time(a),
    oldest: (a, b) => time(a) - time(b),
    author: (a, b) =>
      (a.author ?? "").localeCompare(b.author ?? "", undefined, { sensitivity: "base" }),
    type: (a, b) => ANNOTATION_LABEL[a.type].localeCompare(ANNOTATION_LABEL[b.type]),
    status: (a, b) => STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)],
  };
  return [...edits].sort((a, b) => by[sort](a, b) || byPosition(a, b));
}

/** Distinct authors across comments and their replies, alphabetical. */
export function commentAuthors(edits: AnnotationEdit[]): string[] {
  const set = new Set<string>();
  for (const e of edits) if (e.author) set.add(e.author);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function hasActiveFilters(filters: CommentFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.type !== "all" ||
    filters.status !== "all" ||
    filters.author !== "all" ||
    filters.page !== "all"
  );
}

/** "just now", "5 min ago", "3 h ago", "Jan 4" — compact, for the list rows. */
export function relativeTime(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}
