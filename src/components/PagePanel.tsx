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

  /** Move the page at `from` to `to`, clamped to the list bounds. */
  function move(from: number, to: number) {
    if (to < 0 || to >= pageOrder.length || from === to) return;
    const next = [...pageOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPageOrder(next);
  }

  function onDrop(targetPos: number) {
    if (dragPos === null || dragPos === targetPos) {
      setDragPos(null);
      return;
    }
    move(dragPos, targetPos);
    setDragPos(null);
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
              (dragPos === pos ? " dragging" : "")
            }
            draggable
            onDragStart={() => setDragPos(pos)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(pos)}
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
