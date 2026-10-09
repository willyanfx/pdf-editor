import { useRef, useState } from "react";
import { useEditorStore } from "../store/useEditorStore";
import { newMarkMeta, useCommentsUiStore } from "../store/useCommentsUiStore";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";
import { ANNOTATION_COLOR, stampPreset, stampSize, STAMP_PRESETS } from "../lib/annotations";

type Props = {
  pageIndex: number;
};

type DragRect = { x: number; y: number; width: number; height: number };

/** Modes that drag out a band (text markup), vs. single-click placements. */
type BandMode = "highlight" | "underline" | "strikeout";

/**
 * Overlay active in highlight / underline / strikeout / comment / stamp modes.
 * Drag a rectangle to place a markup band; in comment mode a single click drops
 * a pin; in stamp mode a click drops the chosen stamp (or drag to size it).
 * Each gesture creates the matching edit and returns to select mode.
 */
export function AnnotateLayer({ pageIndex }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const addEdit = useEditorStore((s) => s.addEdit);
  const setMode = useEditorStore((s) => s.setMode);
  const zoom = useEditorStore((s) => s.zoom);
  const stampId = useCommentsUiStore((s) => s.stampId);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DragRect | null>(null);

  const isBand = mode === "highlight" || mode === "underline" || mode === "strikeout";
  if (!isBand && mode !== "comment" && mode !== "stamp") return null;

  function pointIn(e: React.PointerEvent): { x: number; y: number } {
    // getBoundingClientRect() reports post-CSS-transform (zoomed) pixels; divide
    // by zoom so markup is stored in unscaled VIEWER_WIDTH space.
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - bounds.left) / zoom, y: (e.clientY - bounds.top) / zoom };
  }

  function placeStamp(region: DragRect | null, at: { x: number; y: number }) {
    const preset = stampPreset(stampId) ?? STAMP_PRESETS[0];
    const dragged = region && region.width >= 24 && region.height >= 16;
    const size = dragged ? region : stampSize(preset.label);
    // A click centers the stamp on the pointer; a drag uses the dragged box.
    const x = dragged ? region.x : at.x - size.width / 2;
    const y = dragged ? region.y : at.y - size.height / 2;
    addEdit({
      id: crypto.randomUUID(),
      type: "stamp",
      pageIndex,
      // Keep a click-placed stamp on the page (the page is VIEWER_WIDTH wide).
      x: Math.min(Math.max(0, x), Math.max(0, VIEWER_WIDTH - size.width)),
      y: Math.max(0, y),
      width: size.width,
      height: size.height,
      stamp: preset.id,
      label: preset.label,
      color: preset.color,
      ...newMarkMeta(),
    });
    setMode("select");
  }

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    layerRef.current?.setPointerCapture(e.pointerId);
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
        color: ANNOTATION_COLOR.comment,
        ...newMarkMeta(),
      });
      setMode("select");
      return;
    }

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

  function onPointerUp(e: React.PointerEvent) {
    const start = startRef.current;
    const region = rect;
    startRef.current = null;
    setRect(null);
    if (!start) return;

    if (mode === "stamp") {
      placeStamp(region, pointIn(e));
      return;
    }
    if (!region || region.width < 6 || region.height < 6) return;
    if (!isBand) return;

    addEdit({
      id: crypto.randomUUID(),
      type: mode as BandMode,
      pageIndex,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      color: ANNOTATION_COLOR[mode as BandMode],
      ...newMarkMeta(),
    });
    setMode("select");
  }

  return (
    <div
      ref={layerRef}
      className="annotate-layer"
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
          className={`annotate-preview ${mode}`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      )}
    </div>
  );
}
