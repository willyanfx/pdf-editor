import { useRef, useState } from "react";
import { RotateCcw, RotateCw, Crop, Trash2, Undo2, Check } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";

type Props = {
  pageIndex: number;
  /** On-screen page height in px (VIEWER_WIDTH-space) for clamping the crop box. */
  pageHeight: number;
};

type CropRect = { x: number; y: number; width: number; height: number };

/**
 * Contextual per-page toolbar: rotate, crop, reset, and delete. Crop enters a
 * drag mode where the user draws the keep-region; on confirm it's stored as
 * edge insets in the page op. Only visible when this page is the selected one.
 */
export function PageActionsBar({ pageIndex, pageHeight }: Props) {
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);
  const op = useEditorStore((s) => s.pageOps.find((o) => o.pageIndex === pageIndex));
  const setPageOp = useEditorStore((s) => s.setPageOp);
  const { rotatePage, deletePage } = useEditorActions();

  const [cropping, setCropping] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);

  if (selectedPageIndex !== pageIndex) return null;

  const width = 800; // VIEWER_WIDTH

  function pointIn(e: React.MouseEvent) {
    const b = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  function confirmCrop() {
    if (rect && rect.width > 10 && rect.height > 10) {
      setPageOp(pageIndex, {
        crop: {
          left: Math.max(0, rect.x),
          top: Math.max(0, rect.y),
          right: Math.max(0, width - (rect.x + rect.width)),
          bottom: Math.max(0, pageHeight - (rect.y + rect.height)),
        },
      });
    }
    setCropping(false);
    setRect(null);
  }

  return (
    <>
      <div className="page-actions-bar" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" title="Rotate counter-clockwise" onClick={() => rotatePage(-90, pageIndex)}>
          <RotateCcw size={15} />
        </button>
        <button type="button" title="Rotate clockwise" onClick={() => rotatePage(90, pageIndex)}>
          <RotateCw size={15} />
        </button>
        <button
          type="button"
          className={cropping ? "active" : ""}
          title="Crop page"
          onClick={() => setCropping((v) => !v)}
        >
          <Crop size={15} />
        </button>
        {(op?.rotation || op?.crop) && (
          <button
            type="button"
            title="Reset page transforms"
            onClick={() => setPageOp(pageIndex, { rotation: 0, crop: undefined })}
          >
            <Undo2 size={15} />
          </button>
        )}
        <button type="button" className="danger" title="Delete page" onClick={() => deletePage(pageIndex)}>
          <Trash2 size={15} />
        </button>
      </div>

      {cropping && (
        <div
          ref={overlayRef}
          className="crop-overlay"
          onMouseDown={(e) => {
            e.stopPropagation();
            const p = pointIn(e);
            startRef.current = p;
            setRect({ x: p.x, y: p.y, width: 0, height: 0 });
          }}
          onMouseMove={(e) => {
            const start = startRef.current;
            if (!start) return;
            const p = pointIn(e);
            setRect({
              x: Math.min(start.x, p.x),
              y: Math.min(start.y, p.y),
              width: Math.abs(p.x - start.x),
              height: Math.abs(p.y - start.y),
            });
          }}
          onMouseUp={() => {
            startRef.current = null;
          }}
        >
          {rect && (
            <div
              className="crop-rect"
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            >
              <button
                type="button"
                className="crop-confirm"
                title="Apply crop"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  confirmCrop();
                }}
              >
                <Check size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
