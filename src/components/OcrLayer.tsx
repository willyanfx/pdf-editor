import { useRef, useState } from "react";
import { useEditorStore, makeCoverTextEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import type { ScreenRegion } from "../lib/ocr";
import { sampleBackgroundColor } from "../lib/textLayer";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";

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
  const addToast = useToastStore((s) => s.addToast);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DragRect | null>(null);

  if (mode !== "ocr") return null;

  function pointIn(e: React.PointerEvent): { x: number; y: number } {
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (ocrBusy) return;
    e.stopPropagation();
    layerRef.current?.setPointerCapture(e.pointerId);
    const p = pointIn(e);
    startRef.current = p;
    setRect({ x: p.x, y: p.y, width: 0, height: 0 });
  }

  function onPointerMove(e: React.PointerEvent) {
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
      const { recognizePageRegion } = await import("../lib/ocr");
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
      addToast(items.length ? "Text recognized" : "No text found in that region", "info");
    } catch {
      addToast("Could not recognize text in that region.", "error");
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => void onMouseUp()}
      onPointerCancel={() => {
        // Cancel an in-progress drag.
        startRef.current = null;
        setRect(null);
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
