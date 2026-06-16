import { useRef, useState } from "react";
import { useEditorStore, makeTextEdit } from "../store/useEditorStore";

type Props = {
  pageIndex: number;
};

type DragRect = { x: number; y: number; width: number; height: number };

/** Default box size for a click (no-drag) placement, in VIEWER_WIDTH px. */
const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 60;
/** Minimum dimensions so a tiny drag still yields a usable box. */
const MIN_WIDTH = 60;
const MIN_HEIGHT = 28;

/**
 * Overlay active in "addText" mode. The user drags a rectangle to place a new
 * empty text box exactly where they want it (a plain click drops a default-sized
 * box at the click point). On release the box is created and selected — it mounts
 * as an "added" edit, so RichTextEditor auto-focuses it with the caret ready —
 * and the tool returns to select mode.
 */
export function TextDrawLayer({ pageIndex }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const addEdit = useEditorStore((s) => s.addEdit);
  const setMode = useEditorStore((s) => s.setMode);
  const zoom = useEditorStore((s) => s.zoom);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DragRect | null>(null);

  if (mode !== "addText") return null;

  function pointIn(e: React.PointerEvent): { x: number; y: number } {
    // getBoundingClientRect() reports post-CSS-transform (zoomed) pixels; divide
    // by zoom so the box is stored in unscaled VIEWER_WIDTH space.
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - bounds.left) / zoom, y: (e.clientY - bounds.top) / zoom };
  }

  function onPointerDown(e: React.PointerEvent) {
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

  function onPointerUp() {
    const region = rect;
    startRef.current = null;
    setRect(null);
    if (!region) return;

    // A click (no real drag) drops a default-sized box anchored at the click;
    // a deliberate drag uses the drawn rectangle, floored to a usable minimum.
    const dragged = region.width >= 6 && region.height >= 6;
    const box = dragged
      ? {
          x: region.x,
          y: region.y,
          width: Math.max(region.width, MIN_WIDTH),
          height: Math.max(region.height, MIN_HEIGHT),
        }
      : { x: region.x, y: region.y, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };

    addEdit(makeTextEdit({ pageIndex, ...box }));
    // Back to select so the new box can be edited/repositioned immediately.
    setMode("select");
  }

  return (
    <div
      ref={layerRef}
      className="text-draw-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        startRef.current = null;
        setRect(null);
      }}
    >
      {rect && (
        <div
          className="text-draw-preview"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      )}
    </div>
  );
}
