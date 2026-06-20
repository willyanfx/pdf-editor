import { useState } from "react";
import { Thumbnail } from "react-pdf";
import { Trash2, GripVertical } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";

type Props = {
  /** The react-pdf <Document> context is provided by the parent, so Thumbnail
   * here renders against the already-loaded document. */
  onClose: () => void;
};

/**
 * Page organizer: a sidebar of page thumbnails reflecting the current pageOrder.
 * Native HTML5 drag-and-drop reorders pages; the trash button removes a page
 * from the export. Clicking a thumbnail scrolls the viewer to that page.
 */
export function PagePanel(_props: Props) {
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const setPageOrder = useEditorStore((s) => s.setPageOrder);
  const deletePage = useEditorStore((s) => s.deletePage);
  const scrollToPage = useEditorStore((s) => s.scrollToPage);
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);

  const [dragPos, setDragPos] = useState<number | null>(null);
  // The gap the drag is currently hovering: an insertion index in [0, length]
  // (0 = before the first page, length = after the last). null when not dragging.
  const [dropGap, setDropGap] = useState<number | null>(null);

  /** Move the page at `from` to `to`, clamped to the list bounds. */
  function move(from: number, to: number) {
    if (to < 0 || to >= pageOrder.length || from === to) return;
    const next = [...pageOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPageOrder(next);
  }

  /** Reorder by moving the dragged page into the hovered gap, accounting for the
   * index shift when the source sits before the target gap. */
  function moveToGap(from: number, gap: number) {
    const to = gap > from ? gap - 1 : gap;
    move(from, to);
  }

  /** Decide the insertion gap from the pointer's position within a row: above its
   * midpoint inserts before the row, below inserts after. */
  function gapForPointer(e: React.DragEvent, pos: number): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    return after ? pos + 1 : pos;
  }

  function endDrag() {
    setDragPos(null);
    setDropGap(null);
  }

  function onDrop() {
    if (dragPos !== null && dropGap !== null) moveToGap(dragPos, dropGap);
    endDrag();
  }

  function onRowKeyDown(e: React.KeyboardEvent, origIndex: number, pos: number) {
    // Alt+Arrow reorders the page; Enter/Space navigates to it.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(pos, pos + (e.key === "ArrowUp" ? -1 : 1));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      scrollToPage?.(origIndex);
    }
  }

  return (
    <aside className="page-panel" aria-label="Pages">
      <div className="page-panel-title">Pages</div>
      <div className="page-panel-list">
        {pageOrder.map((origIndex, pos) => (
          // role=button (not <button>) so the delete control can legally nest.
          <div
            key={origIndex}
            role="button"
            tabIndex={0}
            aria-label={`Go to page ${pos + 1}. Alt plus arrow keys to reorder.`}
            aria-current={origIndex === selectedPageIndex ? "true" : undefined}
            className={
              "page-thumb" +
              (origIndex === selectedPageIndex ? " current" : "") +
              (dragPos === pos ? " dragging" : "") +
              (dropGap === pos ? " drop-before" : "") +
              (dropGap === pageOrder.length && pos === pageOrder.length - 1 ? " drop-after" : "")
            }
            draggable
            onDragStart={() => setDragPos(pos)}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragPos !== null) setDropGap(gapForPointer(e, pos));
            }}
            onDrop={onDrop}
            onClick={() => scrollToPage?.(origIndex)}
            onKeyDown={(e) => onRowKeyDown(e, origIndex, pos)}
          >
            <GripVertical size={13} className="page-thumb-grip" aria-hidden="true" />
            <Thumbnail
              pageNumber={origIndex + 1}
              width={110}
              loading={<div className="page-thumb-skeleton" />}
            />
            <span className="page-thumb-num">{pos + 1}</span>
            <button
              type="button"
              className="page-thumb-del"
              title="Delete page"
              aria-label={`Delete page ${pos + 1}`}
              disabled={pageOrder.length <= 1}
              onClick={(e) => {
                e.stopPropagation();
                if (pageOrder.length <= 1) return;
                if (window.confirm("Delete this page? This can't be undone.")) {
                  deletePage(origIndex);
                }
              }}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
