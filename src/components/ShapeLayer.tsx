import { useEffect, useRef, useState } from "react";
import { useEditorStore, type EditorMode } from "../store/useEditorStore";
import { newMarkMeta } from "../store/useCommentsUiStore";
import {
  ANNOTATION_COLOR,
  SHAPE_STROKE,
  arrowBarbs,
  arrowHeadLength,
  boxFromPoints,
  cloudSvgPath,
  shapePad,
  type Pt,
} from "../lib/annotations";

type Props = {
  pageIndex: number;
};

type DragMode = "line" | "arrow" | "rectangle" | "oval" | "cloud";
const DRAG_MODES: ReadonlySet<EditorMode> = new Set([
  "line",
  "arrow",
  "rectangle",
  "oval",
  "cloud",
]);

/** Closing a polygon by clicking within this many px of its first vertex. */
const CLOSE_RADIUS = 10;
const MIN_DRAG = 8;

/** Snap `to` so the segment from `from` is a multiple of 45° (Shift held). */
function snap45(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

/**
 * Drawing overlay for the vector annotation tools. Line, arrow, rectangle, oval
 * and cloud are drag gestures; the polygon is click-to-add-vertices (finish with
 * a double-click, a click on the first vertex, or Enter; Esc cancels). Each
 * finished shape becomes an edit and returns to select mode, like the other
 * annotation tools.
 */
export function ShapeLayer({ pageIndex }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const addEdit = useEditorStore((s) => s.addEdit);
  const setMode = useEditorStore((s) => s.setMode);
  const zoom = useEditorStore((s) => s.zoom);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<Pt | null>(null);
  const [drag, setDrag] = useState<{ from: Pt; to: Pt } | null>(null);
  const [vertices, setVertices] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  // Mirrored into a ref so the key handler always sees the latest vertices.
  const verticesRef = useRef<Pt[]>([]);

  const active = DRAG_MODES.has(mode) || mode === "polygon";

  // A half-drawn polygon belongs to one tool activation: drop it on mode change.
  useEffect(() => {
    verticesRef.current = [];
    setVertices([]);
    setHover(null);
    startRef.current = null;
    setDrag(null);
  }, [mode]);

  function finishPolygon(points: Pt[]) {
    verticesRef.current = [];
    setVertices([]);
    setHover(null);
    if (points.length < 3) return;
    addEdit({
      id: crypto.randomUUID(),
      type: "polygon",
      pageIndex,
      ...boxFromPoints(points, shapePad(SHAPE_STROKE)),
      color: ANNOTATION_COLOR.shape,
      strokeWidth: SHAPE_STROKE,
      ...newMarkMeta(),
    });
    setMode("select");
  }

  useEffect(() => {
    if (mode !== "polygon" || vertices.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        finishPolygon(verticesRef.current);
      } else if (e.key === "Escape") {
        e.preventDefault();
        verticesRef.current = [];
        setVertices([]);
        setHover(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // finishPolygon only reads refs and stable store actions.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vertices.length]);

  if (!active) return null;

  function pointIn(e: React.PointerEvent): Pt {
    // getBoundingClientRect() reports post-CSS-transform (zoomed) pixels; divide
    // by zoom so shapes are stored in unscaled VIEWER_WIDTH space.
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - bounds.left) / zoom, y: (e.clientY - bounds.top) / zoom };
  }

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    const p = pointIn(e);

    if (mode === "polygon") {
      const pts = verticesRef.current;
      // A click back on the first vertex closes the shape (a double-click does
      // too, via onDoubleClick: PointerEvent.detail is always 0, so pointerdown
      // can't tell).
      const first = pts[0];
      const closing =
        pts.length >= 3 && first && Math.hypot(p.x - first.x, p.y - first.y) <= CLOSE_RADIUS;
      if (closing) {
        finishPolygon(pts);
        return;
      }
      // The first click of a double-click already added this vertex.
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
      verticesRef.current = [...pts, p];
      setVertices(verticesRef.current);
      return;
    }

    layerRef.current?.setPointerCapture(e.pointerId);
    startRef.current = p;
    setDrag({ from: p, to: p });
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = pointIn(e);
    if (mode === "polygon") {
      setHover(p);
      return;
    }
    const start = startRef.current;
    if (!start) return;
    const to = e.shiftKey && (mode === "line" || mode === "arrow") ? snap45(start, p) : p;
    setDrag({ from: start, to });
  }

  function onPointerUp(e: React.PointerEvent) {
    const start = startRef.current;
    startRef.current = null;
    setDrag(null);
    if (!start || mode === "polygon") return;
    const end =
      e.shiftKey && (mode === "line" || mode === "arrow") ? snap45(start, pointIn(e)) : pointIn(e);
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (mode === "line" || mode === "arrow") {
      if (Math.hypot(dx, dy) < MIN_DRAG) return;
      addEdit({
        id: crypto.randomUUID(),
        type: mode,
        pageIndex,
        ...boxFromPoints([start, end], shapePad(SHAPE_STROKE)),
        color: ANNOTATION_COLOR.shape,
        strokeWidth: SHAPE_STROKE,
        ...newMarkMeta(),
      });
      setMode("select");
      return;
    }

    if (Math.abs(dx) < MIN_DRAG || Math.abs(dy) < MIN_DRAG) return;
    const box = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    };
    const type = mode as DragMode;
    addEdit(
      type === "rectangle"
        ? {
            id: crypto.randomUUID(),
            type,
            pageIndex,
            ...box,
            color: ANNOTATION_COLOR.shape,
            strokeWidth: SHAPE_STROKE,
            ...newMarkMeta(),
          }
        : {
            id: crypto.randomUUID(),
            type: type as "oval" | "cloud",
            pageIndex,
            ...box,
            color: ANNOTATION_COLOR.shape,
            strokeWidth: SHAPE_STROKE,
            ...newMarkMeta(),
          },
    );
    setMode("select");
  }

  const stroke = {
    fill: "none",
    stroke: ANNOTATION_COLOR.shape,
    strokeWidth: SHAPE_STROKE,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeDasharray: "5 4",
  };

  function preview() {
    if (mode === "polygon") {
      if (!vertices.length) return null;
      const pts = hover ? [...vertices, hover] : vertices;
      const first = vertices[0];
      const nearFirst =
        hover &&
        vertices.length >= 3 &&
        Math.hypot(hover.x - first.x, hover.y - first.y) <= CLOSE_RADIUS;
      return (
        <>
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} {...stroke} />
          <circle
            cx={first.x}
            cy={first.y}
            r={nearFirst ? 6 : 3.5}
            fill={nearFirst ? ANNOTATION_COLOR.shape : "white"}
            stroke={ANNOTATION_COLOR.shape}
            strokeWidth={1.5}
          />
        </>
      );
    }
    if (!drag) return null;
    const { from, to } = drag;
    if (mode === "line" || mode === "arrow") {
      const barbs = mode === "arrow" ? arrowBarbs(from, to, arrowHeadLength(SHAPE_STROKE)) : null;
      return (
        <>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} {...stroke} />
          {barbs && Math.hypot(to.x - from.x, to.y - from.y) > 1 && (
            <polyline
              points={`${barbs[0].x},${barbs[0].y} ${to.x},${to.y} ${barbs[1].x},${barbs[1].y}`}
              {...stroke}
              strokeDasharray={undefined}
            />
          )}
        </>
      );
    }
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x);
    const h = Math.abs(to.y - from.y);
    if (mode === "oval")
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...stroke} />;
    if (mode === "cloud")
      return (
        <path
          d={cloudSvgPath(w, h)}
          transform={`translate(${x} ${y})`}
          {...stroke}
          strokeDasharray={undefined}
        />
      );
    return <rect x={x} y={y} width={w} height={h} {...stroke} />;
  }

  return (
    <div
      ref={layerRef}
      className="annotate-layer shape-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => {
        if (mode === "polygon") finishPolygon(verticesRef.current);
      }}
      onPointerCancel={() => {
        startRef.current = null;
        setDrag(null);
      }}
    >
      <svg className="ink-live" aria-hidden="true">
        {preview()}
      </svg>
    </div>
  );
}
