import { useRef, useState } from "react";
import { useEditorStore } from "../store/useEditorStore";

type Props = {
  pageIndex: number;
};

type DragRect = { x: number; y: number; width: number; height: number };

/** Default colors per markup type. */
const MARKUP_COLOR: Record<string, string> = {
  highlight: "#ffe066",
  underline: "#e03131",
  strikeout: "#e03131",
  comment: "#ffd43b",
};

/**
 * Overlay active in highlight / underline / strikeout / comment modes. Drag a
 * rectangle to place a markup band; in comment mode a single click drops a pin.
 * Each gesture creates the matching edit and returns to select mode.
 */
export function AnnotateLayer({ pageIndex }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const addEdit = useEditorStore((s) => s.addEdit);
  const setMode = useEditorStore((s) => s.setMode);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DragRect | null>(null);

  const isMarkup = mode === "highlight" || mode === "underline";
  if (!isMarkup && mode !== "comment") return null;

  function pointIn(e: React.MouseEvent): { x: number; y: number } {
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    const p = pointIn(e);

    if (mode === "comment") {
      addEdit({
        id: crypto.randomUUID(),
        type: "comment",
        pageIndex,
        x: p.x,
        y: p.y,
        width: 20,
        height: 20,
        text: "",
        color: MARKUP_COLOR.comment,
      });
      setMode("select");
      return;
    }

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

  function onMouseUp() {
    const region = rect;
    startRef.current = null;
    setRect(null);
    if (!region || region.width < 6 || region.height < 6) return;
    if (!isMarkup) return;

    addEdit({
      id: crypto.randomUUID(),
      type: mode as "highlight" | "underline",
      pageIndex,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      color: MARKUP_COLOR[mode],
    });
    setMode("select");
  }

  return (
    <div
      ref={layerRef}
      className="annotate-layer"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        if (startRef.current) {
          startRef.current = null;
          setRect(null);
        }
      }}
    >
      {rect && (
        <div
          className={`annotate-preview ${mode}`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      )}
    </div>
  );
}
