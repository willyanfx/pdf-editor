import { useRef, useState } from "react";
import { useEditorStore } from "../store/useEditorStore";

type Props = {
  pageIndex: number;
};

type Pt = { x: number; y: number };

const INK_COLOR = "#1971c2";
const INK_WIDTH = 2.5;

/**
 * Freehand drawing overlay, active only in "ink" mode. Pointer-down starts a
 * stroke; movement appends points; pointer-up commits an InkEdit whose bbox
 * tightly wraps the captured points (points are stored relative to the bbox).
 */
export function InkLayer({ pageIndex }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const addEdit = useEditorStore((s) => s.addEdit);
  const zoom = useEditorStore((s) => s.zoom);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  // Mirror points into a ref so commit() always sees the full stroke even if the
  // last setPoints render hasn't flushed before pointer-up fires.
  const pointsRef = useRef<Pt[]>([]);
  const [points, setPoints] = useState<Pt[]>([]);

  if (mode !== "ink") return null;

  function pointIn(e: React.PointerEvent): Pt {
    // getBoundingClientRect() reports post-CSS-transform (zoomed) pixels; divide
    // by zoom so points are stored in unscaled VIEWER_WIDTH space.
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - bounds.left) / zoom, y: (e.clientY - bounds.top) / zoom };
  }

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    layerRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    pointsRef.current = [pointIn(e)];
    setPoints(pointsRef.current);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawingRef.current) return;
    pointsRef.current = [...pointsRef.current, pointIn(e)];
    setPoints(pointsRef.current);
  }

  function commit() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pts = pointsRef.current;
    pointsRef.current = [];
    setPoints([]);
    if (pts.length < 2) return;

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const pad = INK_WIDTH;
    addEdit({
      id: crypto.randomUUID(),
      type: "ink",
      pageIndex,
      x: minX - pad,
      y: minY - pad,
      width: Math.max(...xs) - minX + pad * 2,
      height: Math.max(...ys) - minY + pad * 2,
      points: pts.map((p) => ({ x: p.x - (minX - pad), y: p.y - (minY - pad) })),
      color: INK_COLOR,
      strokeWidth: INK_WIDTH,
    });
  }

  return (
    <div
      ref={layerRef}
      className="ink-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={commit}
      onPointerCancel={commit}
    >
      {points.length > 1 && (
        <svg className="ink-live">
          <polyline
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={INK_COLOR}
            strokeWidth={INK_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
