import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Link2,
  ListIndentDecrease,
  ListIndentIncrease,
  LocateFixed,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useBookmarksUiStore } from "../store/useBookmarksUiStore";
import { useEditorActions } from "../hooks/useEditorActions";
import {
  allBookmarkIds,
  findBookmark,
  type Bookmark,
  type BookmarkDropPlace,
  type BookmarkMove,
} from "../lib/bookmarks";

type Row = {
  node: Bookmark;
  depth: number;
  parentId: string | null;
  expanded: boolean;
  posInSet: number;
  setSize: number;
};

/** Depth-first list of the rows currently visible (children of collapsed rows hidden). */
function visibleRows(
  tree: Bookmark[],
  collapsed: Record<string, true>,
  depth = 0,
  parentId: string | null = null,
  out: Row[] = [],
): Row[] {
  tree.forEach((node, i) => {
    const expanded = node.children.length > 0 && !collapsed[node.id];
    out.push({ node, depth, parentId, expanded, posInSet: i + 1, setSize: tree.length });
    if (expanded) visibleRows(node.children, collapsed, depth + 1, node.id, out);
  });
  return out;
}

/** Ids of every ancestor of `id`, outermost first. */
function ancestorIds(tree: Bookmark[], id: string): string[] {
  for (const node of tree) {
    if (node.id === id) return [];
    const inner = ancestorIds(node.children, id);
    if (inner.length > 0 || findBookmark(node.children, id)) return [node.id, ...inner];
  }
  return [];
}

/** Dropping in the top/bottom quarter of a row places before/after it; the
 * middle nests inside it. */
function dropPlaceFor(e: React.DragEvent): BookmarkDropPlace {
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1);
  return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
}

/** Inline title editor. Enter or leaving the field saves; Escape cancels. */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  /** `fromKeyboard`: saved with Enter, so focus should return to the row
   * (when saved by clicking elsewhere, focus stays where the user clicked). */
  onCommit: (value: string, fromKeyboard: boolean) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);

  // Focus on the next frame rather than with autoFocus: when renaming starts
  // from the command palette, the palette's focus trap restores focus as it
  // unmounts, which would otherwise pull focus straight back out of here.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function finish(commit: boolean, fromKeyboard = false) {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? initial, fromKeyboard);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      className="bm-rename"
      aria-label="Bookmark title"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

/**
 * The document's bookmarks (outline) as a keyboard-accessible tree. Clicking a
 * bookmark jumps to its page; the toolbar and keyboard shortcuts rename, move,
 * nest, retarget and delete the selected one. Every change is undoable.
 *
 * Keyboard (on a bookmark): ↑/↓ move between bookmarks, →/← expand/collapse,
 * Enter jumps to the page, F2 renames, Delete removes, Alt+↑/↓ reorders and
 * Alt+→/← nests/un-nests.
 */
export function BookmarksPanel() {
  const bookmarks = useEditorStore((s) => s.bookmarks);
  const outlineStatus = useEditorStore((s) => s.outlineStatus);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const numPages = useEditorStore((s) => s.numPages);
  const currentPage = useEditorStore((s) => s.selectedPageIndex);
  const scrollToPage = useEditorStore((s) => s.scrollToPage);
  const { addBookmark } = useEditorActions();

  const collapsed = useBookmarksUiStore((s) => s.collapsed);
  const selectedId = useBookmarksUiStore((s) => s.selectedId);
  const renamingId = useBookmarksUiStore((s) => s.renamingId);
  const ui = useBookmarksUiStore.getState;

  const rows = useMemo(() => visibleRows(bookmarks, collapsed), [bookmarks, collapsed]);
  const order = useMemo(
    () => (pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i)),
    [pageOrder, numPages],
  );
  const positionOf = useMemo(() => {
    const map = new Map(order.map((orig, pos) => [orig, pos]));
    return (pageIndex: number) => map.get(pageIndex) ?? -1;
  }, [order]);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // Set by keyboard actions so focus follows the bookmark after a re-render
  // (moving a row re-inserts its DOM node, which drops focus).
  const focusAfterRender = useRef<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    over?: { id: string; place: BookmarkDropPlace };
  }>();

  const selected = selectedId ? findBookmark(bookmarks, selectedId) : null;
  const editable = outlineStatus !== "pending";

  // Keep the selected bookmark visible: expand its ancestors (e.g. after
  // indenting under a collapsed bookmark, or revealing a new one).
  useEffect(() => {
    if (!selectedId) return;
    for (const id of ancestorIds(bookmarks, selectedId)) ui().setCollapsed(id, false);
  }, [selectedId, bookmarks, ui]);

  // Scroll a newly revealed/selected bookmark into view.
  useEffect(() => {
    if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useLayoutEffect(() => {
    const id = focusAfterRender.current;
    if (!id || renamingId) return;
    focusAfterRender.current = null;
    rowRefs.current.get(id)?.focus();
  });

  /** Page this bookmark jumps to, or null when it can't (link, deleted page). */
  function liveTarget(node: Bookmark): number | null {
    if (node.pageIndex === null) return null;
    return positionOf(node.pageIndex) >= 0 ? node.pageIndex : null;
  }

  function go(node: Bookmark) {
    const target = liveTarget(node);
    if (target !== null) scrollToPage?.(target);
  }

  function focusRow(id: string) {
    ui().select(id);
    rowRefs.current.get(id)?.focus();
  }

  function move(id: string, how: BookmarkMove, fromKeyboard = false) {
    if (fromKeyboard) focusAfterRender.current = id;
    useEditorStore.getState().moveBookmark(id, how);
  }

  function remove(id: string) {
    const idx = rows.findIndex((r) => r.node.id === id);
    // Select the next visible bookmark outside the deleted subtree, else the previous one.
    const loc = findBookmark(bookmarks, id);
    const doomed = new Set(loc ? [id, ...allBookmarkIds(loc.node.children)] : [id]);
    const next =
      rows.slice(idx + 1).find((r) => !doomed.has(r.node.id)) ??
      rows
        .slice(0, Math.max(idx, 0))
        .reverse()
        .find((r) => !doomed.has(r.node.id));
    useEditorStore.getState().deleteBookmark(id);
    ui().select(next?.node.id ?? null);
    if (next) focusAfterRender.current = next.node.id;
  }

  function retarget(id: string) {
    if (positionOf(currentPage) < 0) return;
    // A new page invalidates the old vertical target and any link action.
    useEditorStore
      .getState()
      .updateBookmark(id, { pageIndex: currentPage, top: undefined, url: undefined });
  }

  function commitRename(id: string, value: string, refocus: boolean) {
    const title = value.replace(/\s+/g, " ").trim();
    const node = findBookmark(useEditorStore.getState().bookmarks, id)?.node;
    ui().setRenaming(null);
    if (refocus) focusAfterRender.current = id;
    if (node && title && title !== node.title) {
      useEditorStore.getState().updateBookmark(id, { title });
    }
  }

  function onRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>, row: Row, index: number) {
    if (e.target !== e.currentTarget) return; // keys typed in the rename box
    const id = row.node.id;
    let handled = true;
    if (e.altKey && editable && e.key === "ArrowUp") move(id, "up", true);
    else if (e.altKey && editable && e.key === "ArrowDown") move(id, "down", true);
    else if (e.altKey && editable && e.key === "ArrowRight") move(id, "indent", true);
    else if (e.altKey && editable && e.key === "ArrowLeft") move(id, "outdent", true);
    else if (e.altKey || e.metaKey || e.ctrlKey) handled = false;
    else if (e.key === "ArrowDown") {
      const next = rows[index + 1];
      if (next) focusRow(next.node.id);
    } else if (e.key === "ArrowUp") {
      const prev = rows[index - 1];
      if (prev) focusRow(prev.node.id);
    } else if (e.key === "Home") {
      if (rows[0]) focusRow(rows[0].node.id);
    } else if (e.key === "End") {
      const last = rows[rows.length - 1];
      if (last) focusRow(last.node.id);
    } else if (e.key === "ArrowRight") {
      if (row.node.children.length > 0 && !row.expanded) ui().setCollapsed(id, false);
      else if (row.expanded) focusRow(row.node.children[0].id);
    } else if (e.key === "ArrowLeft") {
      if (row.expanded) ui().setCollapsed(id, true);
      else if (row.parentId) focusRow(row.parentId);
    } else if (e.key === "Enter" || e.key === " ") {
      ui().select(id);
      go(row.node);
    } else if (e.key === "F2" && editable) {
      ui().setRenaming(id);
    } else if ((e.key === "Delete" || e.key === "Backspace") && editable) {
      remove(id);
    } else handled = false;

    if (handled) {
      e.preventDefault();
      // Keep App's global shortcuts (edit nudge/delete, tool keys) out of it.
      e.stopPropagation();
    }
  }

  const tabStopId =
    selectedId && rows.some((r) => r.node.id === selectedId) ? selectedId : rows[0]?.node.id;
  const canRetarget = !!selected && positionOf(currentPage) >= 0;
  const currentPageLabel = positionOf(currentPage) + 1;

  return (
    <div className="bm-panel">
      <div className="bm-header">
        <button
          type="button"
          className="bm-add"
          onClick={() => addBookmark()}
          disabled={!editable}
          title="Bookmark the current page (⌘B)"
        >
          <BookmarkPlus size={14} aria-hidden="true" />
          <span>Add</span>
        </button>
        <span className="bm-header-spacer" />
        <button
          type="button"
          className="bm-icon-btn"
          aria-label="Expand all bookmarks"
          title="Expand all"
          onClick={() => ui().expandAll()}
          disabled={bookmarks.length === 0}
        >
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bm-icon-btn"
          aria-label="Collapse all bookmarks"
          title="Collapse all"
          onClick={() => ui().collapseAll(allBookmarkIds(bookmarks))}
          disabled={bookmarks.length === 0}
        >
          <ChevronsDownUp size={14} aria-hidden="true" />
        </button>
      </div>

      {outlineStatus === "pending" ? (
        <p className="bm-empty">Loading bookmarks…</p>
      ) : rows.length === 0 ? (
        <p className="bm-empty">
          {outlineStatus === "failed"
            ? "This file's bookmarks couldn't be read. You can still add new ones."
            : "No bookmarks yet. Go to a page and choose Add (⌘B) to bookmark it."}
        </p>
      ) : (
        <div className="bm-tree" role="tree" aria-label="Bookmarks">
          {rows.map((row, index) => {
            const { node } = row;
            const isSelected = node.id === selectedId;
            const target = liveTarget(node);
            const missing = node.pageIndex !== null && target === null;
            const pageLabel =
              node.pageIndex === null
                ? null
                : missing
                  ? "Deleted"
                  : String(positionOf(node.pageIndex) + 1);
            const hint = node.url
              ? `Web link: ${node.url}`
              : node.pageIndex === null
                ? "This bookmark doesn't point to a page"
                : missing
                  ? "Its page was deleted. It will be left out of the download."
                  : `Page ${pageLabel}`;
            const over = drag?.over?.id === node.id ? drag.over.place : null;
            return (
              <div
                key={node.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(node.id, el);
                  else rowRefs.current.delete(node.id);
                }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-expanded={node.children.length > 0 ? row.expanded : undefined}
                aria-selected={isSelected}
                aria-disabled={target === null ? true : undefined}
                aria-label={`${node.title}, ${hint}`}
                tabIndex={node.id === tabStopId ? 0 : -1}
                className={
                  "bm-row" +
                  (isSelected ? " selected" : "") +
                  (target === null ? " no-target" : "") +
                  (drag?.id === node.id ? " dragging" : "") +
                  (over ? ` drop-${over}` : "")
                }
                style={{ paddingLeft: 4 + row.depth * 14 }}
                title={hint}
                draggable={editable && renamingId !== node.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", node.title);
                  setDrag({ id: node.id });
                }}
                onDragEnd={() => setDrag(undefined)}
                onDragOver={(e) => {
                  if (!drag || drag.id === node.id) return;
                  e.preventDefault();
                  const place = dropPlaceFor(e);
                  if (drag.over?.id !== node.id || drag.over.place !== place) {
                    setDrag({ id: drag.id, over: { id: node.id, place } });
                  }
                }}
                onDrop={(e) => {
                  if (!drag || drag.id === node.id) return;
                  e.preventDefault();
                  useEditorStore.getState().moveBookmarkTo(drag.id, node.id, dropPlaceFor(e));
                  ui().select(drag.id);
                  setDrag(undefined);
                }}
                onClick={() => {
                  ui().select(node.id);
                  go(node);
                }}
                onDoubleClick={() => editable && ui().setRenaming(node.id)}
                onKeyDown={(e) => onRowKeyDown(e, row, index)}
              >
                <span
                  className={"bm-twisty" + (row.expanded ? " open" : "")}
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (node.children.length > 0) ui().toggleCollapsed(node.id);
                  }}
                >
                  {node.children.length > 0 && <ChevronRight size={12} />}
                </span>
                {renamingId === node.id ? (
                  <RenameInput
                    initial={node.title}
                    onCommit={(value, fromKeyboard) => commitRename(node.id, value, fromKeyboard)}
                    onCancel={() => {
                      ui().setRenaming(null);
                      focusAfterRender.current = node.id;
                    }}
                  />
                ) : (
                  <span className="bm-title">{node.title}</span>
                )}
                {node.url ? (
                  <Link2 size={12} className="bm-page" aria-hidden="true" />
                ) : (
                  pageLabel && <span className="bm-page">{pageLabel}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="bm-actions" role="toolbar" aria-label="Selected bookmark">
        <button
          type="button"
          className="bm-icon-btn"
          aria-label="Rename bookmark"
          title="Rename (F2)"
          disabled={!selected || !editable}
          onClick={() => selected && ui().setRenaming(selected.node.id)}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bm-icon-btn"
          aria-label={`Point bookmark at the current page (page ${currentPageLabel})`}
          title={`Point at the current page (${currentPageLabel})`}
          disabled={!selected || !editable || !canRetarget}
          onClick={() => selected && retarget(selected.node.id)}
        >
          <LocateFixed size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bm-icon-btn"
          aria-label="Move bookmark up"
          title="Move up (Alt+↑)"
          disabled={!selected || !editable || selected.index === 0}
          onClick={() => selected && move(selected.node.id, "up")}
        >
          <ArrowUp size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bm-icon-btn"
          aria-label="Move bookmark down"
          title="Move down (Alt+↓)"
          disabled={!selected || !editable || selected.index === selected.siblings.length - 1}
          onClick={() => selected && move(selected.node.id, "down")}
        >
          <ArrowDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bm-icon-btn"
          aria-label="Nest under the bookmark above"
          title="Nest under the one above (Alt+→)"
          disabled={!selected || !editable || selected.index === 0}
          onClick={() => selected && move(selected.node.id, "indent")}
        >
          <ListIndentIncrease size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bm-icon-btn"
          aria-label="Move out one level"
          title="Move out one level (Alt+←)"
          disabled={!selected || !editable || selected.depth === 0}
          onClick={() => selected && move(selected.node.id, "outdent")}
        >
          <ListIndentDecrease size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bm-icon-btn bm-delete"
          aria-label="Delete bookmark"
          title={
            selected && selected.node.children.length > 0
              ? "Delete (with the bookmarks inside it)"
              : "Delete"
          }
          disabled={!selected || !editable}
          onClick={() => selected && remove(selected.node.id)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
