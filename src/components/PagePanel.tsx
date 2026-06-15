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

  function onDrop(targetPos: number) {
    if (dragPos === null || dragPos === targetPos) {
      setDragPos(null);
      return;
    }
    const next = [...pageOrder];
    const [moved] = next.splice(dragPos, 1);
    next.splice(targetPos, 0, moved);
    setPageOrder(next);
    setDragPos(null);
  }

  return (
    <aside className="page-panel" aria-label="Pages">
      <div className="page-panel-title">Pages</div>
      <div className="page-panel-list">
        {pageOrder.map((origIndex, pos) => (
          <div
            key={origIndex}
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
          >
            <GripVertical size={13} className="page-thumb-grip" />
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
              onClick={(e) => {
                e.stopPropagation();
                if (pageOrder.length > 1) deletePage(origIndex);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
