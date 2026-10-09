import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Circle,
  Cloud,
  FileDown,
  FileUp,
  Highlighter,
  MessageSquare,
  Minus,
  MoveUpRight,
  PenTool,
  Pentagon,
  Square,
  Stamp,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import {
  ANONYMOUS,
  currentAuthor,
  useCommentsUiStore,
  type CommentSort,
} from "../store/useCommentsUiStore";
import {
  ANNOTATION_LABEL,
  REVIEW_STATUSES,
  STATUS_LABEL,
  annotationTitle,
  isAnnotation,
  newReply,
  statusOf,
  type AnnotationEdit,
  type AnnotationType,
} from "../lib/annotations";
import {
  commentAuthors,
  filterComments,
  hasActiveFilters,
  relativeTime,
  sortComments,
} from "../lib/commentList";
import { useEditorActions } from "../hooks/useEditorActions";
import type { AnnotationMode } from "../lib/annotationExport";

const TYPE_ICON: Record<AnnotationType, ReactNode> = {
  highlight: <Highlighter size={14} />,
  underline: <Underline size={14} />,
  strikeout: <Strikethrough size={14} />,
  comment: <MessageSquare size={14} />,
  ink: <PenTool size={14} />,
  rectangle: <Square size={14} />,
  line: <Minus size={14} />,
  arrow: <MoveUpRight size={14} />,
  oval: <Circle size={14} />,
  polygon: <Pentagon size={14} />,
  cloud: <Cloud size={14} />,
  stamp: <Stamp size={14} />,
};

const SORT_LABEL: Record<CommentSort, string> = {
  page: "Sort: page order",
  newest: "Sort: newest first",
  oldest: "Sort: oldest first",
  author: "Sort: author",
  type: "Sort: type",
  status: "Sort: status",
};

/** The page number the page panel shows (visible order), falling back to the
 * original index before the order is seeded. */
function pageNumber(pageOrder: number[], pageIndex: number): number {
  const pos = pageOrder.indexOf(pageIndex);
  return (pos < 0 ? pageIndex : pos) + 1;
}

/** The mark's own color, for the row's swatch. */
function swatchOf(edit: AnnotationEdit): string {
  return ("color" in edit && edit.color) || "#111827";
}

/**
 * The sidebar's Comments view: every comment and markup in the document as a
 * filterable, sortable list. Opening a row shows its thread: the note, review
 * status, replies. The footer holds XFDF import/export and the choice between
 * keeping comments native or flattening them on download.
 */
export function CommentsPanel() {
  const edits = useEditorStore((s) => s.edits);
  const selectedEditId = useEditorStore((s) => s.selectedEditId);
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const setSelectedPageIndex = useEditorStore((s) => s.setSelectedPageIndex);
  const scrollToPage = useEditorStore((s) => s.scrollToPage);
  const pageOrder = useEditorStore((s) => s.pageOrder);

  const filters = useCommentsUiStore((s) => s.filters);
  const sort = useCommentsUiStore((s) => s.sort);
  const expandedId = useCommentsUiStore((s) => s.expandedId);
  const setFilters = useCommentsUiStore((s) => s.setFilters);
  const clearFilters = useCommentsUiStore((s) => s.clearFilters);
  const setSort = useCommentsUiStore((s) => s.setSort);
  const setExpandedId = useCommentsUiStore((s) => s.setExpandedId);

  const all = useMemo(() => edits.filter(isAnnotation), [edits]);
  const authors = useMemo(() => commentAuthors(all), [all]);
  const shown = useMemo(
    () => sortComments(filterComments(all, filters, selectedPageIndex), sort, pageOrder),
    [all, filters, sort, selectedPageIndex, pageOrder],
  );
  const filtered = hasActiveFilters(filters);

  // Clicking a mark on the page opens its thread here.
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedEditId === lastSelected.current) return;
    lastSelected.current = selectedEditId;
    if (selectedEditId && all.some((e) => e.id === selectedEditId)) {
      setExpandedId(selectedEditId);
    }
  }, [selectedEditId, all, setExpandedId]);

  // Bring the opened row into view (it may have been opened from the page).
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    if (!expandedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(expandedId)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [expandedId]);

  function open(edit: AnnotationEdit) {
    selectEdit(edit.id);
    setSelectedPageIndex(edit.pageIndex);
    scrollToPage?.(edit.pageIndex);
    setExpandedId(expandedId === edit.id ? null : edit.id);
  }

  // A thread whose mark was filtered out (or deleted) shouldn't stay "open".
  const expanded = shown.find((e) => e.id === expandedId) ?? null;

  return (
    <div className="cm-panel">
      <div className="cm-toolbar">
        <input
          type="search"
          className="cm-search"
          placeholder="Search comments"
          aria-label="Search comments"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
        />
        <div className="cm-filters">
          <select
            aria-label="Filter by type"
            value={filters.type}
            onChange={(e) => setFilters({ type: e.target.value as AnnotationType | "all" })}
          >
            <option value="all">All types</option>
            {(Object.keys(ANNOTATION_LABEL) as AnnotationType[]).map((t) => (
              <option key={t} value={t}>
                {ANNOTATION_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by review status"
            value={filters.status}
            onChange={(e) =>
              setFilters({ status: e.target.value as (typeof REVIEW_STATUSES)[number] | "all" })
            }
          >
            <option value="all">Any status</option>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by author"
            value={filters.author}
            onChange={(e) => setFilters({ author: e.target.value })}
          >
            <option value="all">All authors</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort comments"
            value={sort}
            onChange={(e) => setSort(e.target.value as CommentSort)}
          >
            {(Object.keys(SORT_LABEL) as CommentSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="cm-meta">
          <label className="cm-check">
            <input
              type="checkbox"
              checked={filters.page === "current"}
              onChange={(e) => setFilters({ page: e.target.checked ? "current" : "all" })}
            />
            This page only
          </label>
          <span className="cm-count" aria-live="polite">
            {filtered ? `${shown.length} of ${all.length}` : all.length}{" "}
            {all.length === 1 ? "comment" : "comments"}
            {filtered && (
              <>
                {" · "}
                <button type="button" className="cm-link" onClick={clearFilters}>
                  Clear
                </button>
              </>
            )}
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="cm-empty">
          {all.length === 0
            ? "No comments yet. Use the highlight, sticky note, shape or stamp tools to add some."
            : "No comments match these filters."}
        </p>
      ) : (
        <ul className="cm-list" ref={listRef}>
          {shown.map((edit) => {
            const status = statusOf(edit);
            const isOpen = expanded?.id === edit.id;
            const replyCount = edit.replies?.length ?? 0;
            return (
              <li
                key={edit.id}
                data-comment-id={edit.id}
                className={
                  "cm-item" +
                  (selectedEditId === edit.id ? " selected" : "") +
                  (isOpen ? " open" : "")
                }
              >
                <button
                  type="button"
                  className="cm-row"
                  aria-expanded={isOpen}
                  onClick={() => open(edit)}
                >
                  <span className="cm-icon" style={{ color: swatchOf(edit) }} aria-hidden="true">
                    {TYPE_ICON[edit.type]}
                  </span>
                  <span className="cm-body">
                    <span className="cm-head">
                      <span className="cm-author">{edit.author || ANONYMOUS}</span>
                      <span className="cm-when">{relativeTime(edit.createdAt)}</span>
                    </span>
                    <span className={"cm-text" + (edit.text?.trim() ? "" : " placeholder")}>
                      {annotationTitle(edit)}
                    </span>
                    <span className="cm-sub">
                      Page {pageNumber(pageOrder, edit.pageIndex)}
                      {edit.text?.trim() ? ` · ${ANNOTATION_LABEL[edit.type]}` : ""}
                      {replyCount > 0 &&
                        ` · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
                      {status !== "none" && (
                        <span className={`cm-status cm-status-${status}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                {isOpen && <CommentThread edit={edit} />}
              </li>
            );
          })}
        </ul>
      )}

      <CommentsFooter />
    </div>
  );
}

/** The open row: note, review status, replies and the reply box. */
function CommentThread({ edit }: { edit: AnnotationEdit }) {
  const updateEdit = useEditorStore((s) => s.updateEdit);
  const deleteEdit = useEditorStore((s) => s.deleteEdit);
  const [draft, setDraft] = useState("");
  const replies = edit.replies ?? [];

  function addReply() {
    const text = draft.trim();
    if (!text) return;
    const now = Date.now();
    updateEdit(edit.id, {
      replies: [...replies, newReply(currentAuthor(), text, now)],
      modifiedAt: now,
    });
    setDraft("");
  }

  return (
    <div className="cm-thread">
      <textarea
        className="cm-note"
        aria-label="Comment note"
        placeholder={edit.type === "comment" ? "Add a comment…" : "Add a note to this mark…"}
        value={edit.text ?? ""}
        rows={2}
        onChange={(e) => updateEdit(edit.id, { text: e.target.value, modifiedAt: Date.now() })}
      />

      <label className="cm-field">
        Review status
        <select
          aria-label="Review status"
          value={statusOf(edit)}
          onChange={(e) =>
            updateEdit(edit.id, {
              status: e.target.value as (typeof REVIEW_STATUSES)[number],
              modifiedAt: Date.now(),
            })
          }
        >
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      {replies.length > 0 && (
        <ul className="cm-replies" aria-label="Replies">
          {replies.map((r) => (
            <li key={r.id} className="cm-reply">
              <div className="cm-head">
                <span className="cm-author">{r.author}</span>
                <span className="cm-when">{relativeTime(r.createdAt)}</span>
                <button
                  type="button"
                  className="cm-icon-btn"
                  title="Delete reply"
                  aria-label={`Delete reply by ${r.author}`}
                  onClick={() =>
                    updateEdit(edit.id, {
                      replies: replies.filter((x) => x.id !== r.id),
                      modifiedAt: Date.now(),
                    })
                  }
                >
                  <X size={12} />
                </button>
              </div>
              <p className="cm-reply-text">{r.text}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="cm-reply-box">
        <textarea
          aria-label="Reply"
          placeholder="Reply…"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              addReply();
            }
          }}
        />
        <div className="cm-reply-actions">
          <button
            type="button"
            className="cm-btn primary"
            disabled={!draft.trim()}
            onClick={addReply}
          >
            Reply
          </button>
          <button
            type="button"
            className="cm-btn danger"
            onClick={() => deleteEdit(edit.id)}
            title="Delete this comment and its replies"
          >
            <Trash2 size={13} aria-hidden="true" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentsFooter() {
  const authorName = useCommentsUiStore((s) => s.authorName);
  const setAuthorName = useCommentsUiStore((s) => s.setAuthorName);
  const exportMode = useCommentsUiStore((s) => s.exportMode);
  const setExportMode = useCommentsUiStore((s) => s.setExportMode);
  const hasComments = useEditorStore((s) => s.edits.some(isAnnotation));
  const { importXfdf, exportXfdf } = useEditorActions();

  return (
    <div className="cm-footer">
      <label className="cm-inline">
        <span>Commenting as</span>
        <input
          type="text"
          value={authorName}
          placeholder={ANONYMOUS}
          maxLength={60}
          onChange={(e) => setAuthorName(e.target.value)}
        />
      </label>

      <label className="cm-inline">
        <span>On download</span>
        <select
          value={exportMode}
          onChange={(e) => setExportMode(e.target.value as AnnotationMode)}
        >
          <option value="flatten">Flatten into the page</option>
          <option value="native">Keep as comments</option>
        </select>
      </label>
      <small className="cm-hint">
        {exportMode === "native"
          ? "Notes, replies and review status stay editable in Acrobat and other PDF viewers."
          : "Marks become part of the page. Notes and replies are not kept."}
      </small>

      <div className="cm-xfdf">
        <button type="button" className="cm-btn" onClick={importXfdf}>
          <FileUp size={13} aria-hidden="true" /> Import XFDF
        </button>
        <button
          type="button"
          className="cm-btn"
          disabled={!hasComments}
          onClick={() => void exportXfdf()}
        >
          <FileDown size={13} aria-hidden="true" /> Export XFDF
        </button>
      </div>
    </div>
  );
}
