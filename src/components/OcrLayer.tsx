import { useRef, useState } from "react";
import { useEditorStore, makeCoverTextEdit } from "../store/useEditorStore";
import { recognizePageRegion, type ScreenRegion } from "../lib/ocr";
import { sampleBackgroundColor } from "../lib/textLayer";
import { VIEWER_WIDTH } from "../lib/exportPdf";

type Props = {
  pageIndex: number;
  getCanvas: () => HTMLCanvasElement | null;
};

type DragRect = { x: number; y: number; width: number; height: number };

/**
 * Region-select overlay, active only in "ocr" mode. The user drags a rectangle
 * over the page; on release we OCR just that region and turn each recognized
 * line into a cover-text edit (the OCR text replaces the scanned pixels).
 */
export function OcrLayer({ pageIndex, getCanvas }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const addEdit = useEditorStore((s) => s.addEdit);
  const setMode = useEditorStore((s) => s.setMode);
  const setOcrBusy = useEditorStore((s) => s.setOcrBusy);
  const setOcrProgress = useEditorStore((s) => s.setOcrProgress);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DragRect | null>(null);

  if (mode !== "ocr") return null;

  function pointIn(e: React.MouseEvent): { x: number; y: number } {
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (ocrBusy) return;
    e.stopPropagation();
    const p = pointIn(e);
    startRef.current = p;
    setRect({ x: p.x, y: p.y, width: 0, height: 0 });
  }

  function onMouseMove(e: React.MouseEvent) {
    const start = startRef.current;
    if (!start) return;
    const p = pointIn(e);
    setRect({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y),
    });
  }

  async function onMouseUp() {
    const region = rect;
    startRef.current = null;
    setRect(null);
    // Ignore tiny/accidental drags.
    if (!region || region.width < 6 || region.height < 6) return;

    const canvas = getCanvas();
    if (!canvas) return;

    setOcrBusy(true);
    setOcrProgress(0);
    try {
      const items = await recognizePageRegion(
        canvas,
        VIEWER_WIDTH,
        region as ScreenRegion,
        setOcrProgress,
      );
      for (const it of items) {
        const coverColor = sampleBackgroundColor(
          canvas,
          it.x,
          it.y,
          it.width,
          it.height,
          VIEWER_WIDTH,
        );
        addEdit(makeCoverTextEdit(it, pageIndex, coverColor));
      }
    } finally {
      setOcrBusy(false);
      setOcrProgress(0);
      // Drop back to select so the user can reposition/edit the new boxes.
      setMode("select");
    }
  }

  return (
    <div
      ref={layerRef}
      className="ocr-layer"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={() => void onMouseUp()}
      onMouseLeave={() => {
        // Cancel an in-progress drag that leaves the page.
        if (startRef.current) {
          startRef.current = null;
          setRect(null);
        }
      }}
    >
      {rect && (
        <div
          className="ocr-selection-rect"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      )}
    </div>
  );
}
