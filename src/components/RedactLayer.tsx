import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { useEditorStore, type RedactEdit, type TextEdit } from "../store/useEditorStore";
import { extractScreenTextItems, type ScreenTextItem } from "../lib/textLayer";
import { VIEWER_WIDTH, type ScreenRect } from "../lib/pdfGeometry";
import { hitsText, textRectsUnderDrag } from "../lib/redactGeometry";

type Props = {
  pageIndex: number;
  page: PDFPageProxy | null;
};

/** Drags smaller than this (both axes) count as a click. */
const CLICK_PX = 4;

/**
 * Overlay active in "redact" mode. Starting a drag on text (existing PDF text
 * or an editable text box) snaps the mark to the covered words, one mark per
 * line — the Acrobat convention; a click on a word marks that word. Starting
 * on empty page area marks the dragged rectangle as-is. The mode stays active
 * so several areas can be marked in a row (V / Select to leave).
 */
export function RedactLayer({ pageIndex, page }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const zoom = useEditorStore((s) => s.zoom);
  const addEdits = useEditorStore((s) => s.addEdits);
  const allEdits = useEditorStore((s) => s.edits);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number; onText: boolean } | null>(null);
  const [drag, setDrag] = useState<ScreenRect | null>(null);
  const [blocks, setBlocks] = useState<ScreenTextItem[]>([]);

  const active = mode === "redact";

  // Text geometry for snapping. Only extracted while the tool is active so
  // pages never pay for it otherwise.
  useEffect(() => {
    if (!active || !page) {
      setBlocks([]);
      return;
    }
    let cancelled = false;
    void extractScreenTextItems(page, VIEWER_WIDTH).then((items) => {
      if (!cancelled) setBlocks(items);
    });
    return () => {
      cancelled = true;
    };
  }, [active, page]);

  const overlays = useMemo(
    () => allEdits.filter((e): e is TextEdit => e.type === "text" && e.pageIndex === pageIndex),
    [allEdits, pageIndex],
  );

  if (!active) return null;

  function pointIn(e: React.PointerEvent): { x: number; y: number } {
    // getBoundingClientRect() reports post-CSS-transform (zoomed) pixels; divide
    // by zoom so marks are stored in unscaled VIEWER_WIDTH space.
    const bounds = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - bounds.left) / zoom, y: (e.clientY - bounds.top) / zoom };
  }

  /** The marks a drag rect would produce right now (also used for live preview). */
  function marksFor(rect: ScreenRect, onText: boolean): ScreenRect[] {
    if (onText) {
      const probe =
        rect.width < CLICK_PX && rect.height < CLICK_PX
          ? { x: rect.x, y: rect.y, width: 1, height: 1 }
          : rect;
      const snapped = textRectsUnderDrag(probe, blocks, overlays);
      if (snapped.length > 0) return snapped;
    }
    return rect.width >= CLICK_PX && rect.height >= CLICK_PX ? [rect] : [];
  }

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    layerRef.current?.setPointerCapture(e.pointerId);
    const p = pointIn(e);
    startRef.current = { ...p, onText: hitsText(p, blocks, overlays) };
    setDrag({ x: p.x, y: p.y, width: 0, height: 0 });
  }

  function onPointerMove(e: React.PointerEvent) {
    const start = startRef.current;
    if (!start) return;
    const p = pointIn(e);
    setDrag({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y),
    });
  }

  function onPointerUp() {
    const start = startRef.current;
    const rect = drag;
    startRef.current = null;
    setDrag(null);
    if (!start || !rect) return;
    const rects = marksFor(rect, start.onText);
    if (rects.length === 0) return;
    const marks: RedactEdit[] = rects.map((r) => ({
      id: crypto.randomUUID(),
      type: "redact",
      pageIndex,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }));
    addEdits(marks);
  }

  const preview = drag && startRef.current ? marksFor(drag, startRef.current.onText) : [];

  return (
    <div
      ref={layerRef}
      className="redact-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        startRef.current = null;
        setDrag(null);
      }}
    >
      {drag && preview.length === 0 && (
        <div
          className="redact-drag-preview faint"
          style={{ left: drag.x, top: drag.y, width: drag.width, height: drag.height }}
        />
      )}
      {preview.map((r, i) => (
        <div
          key={i}
          className="redact-drag-preview"
          style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}
