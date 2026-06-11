import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { useEditorStore, makeTextEdit } from "../store/useEditorStore";
import {
  extractScreenTextItems,
  sampleBackgroundColor,
  type ScreenTextItem,
} from "../lib/textLayer";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";

type Props = {
  pageIndex: number;
  page: PDFPageProxy | null;
  getCanvas: () => HTMLCanvasElement | null;
};

/**
 * Transparent, clickable spans positioned over the existing PDF text. Only
 * active in "editText" mode. Clicking a span lifts that run of text into an
 * editable box (origin: "existing") and hides the original on export by
 * covering it with a sampled-color rectangle.
 */
export function ExistingTextLayer({ pageIndex, page, getCanvas }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const addEdit = useEditorStore((s) => s.addEdit);
  const edits = useEditorStore((s) => s.edits);
  const [items, setItems] = useState<ScreenTextItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!page) {
      setItems([]);
      return;
    }
    void extractScreenTextItems(page, VIEWER_WIDTH).then((result) => {
      if (!cancelled) setItems(result);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  if (mode !== "editText" || items.length === 0) return null;

  // Hide a span once it's been lifted into an edit at (roughly) its position,
  // so the user doesn't see the original peeking out behind their edit box.
  const covered = edits.filter(
    (e) => e.type === "text" && e.origin === "existing" && e.pageIndex === pageIndex,
  );
  const isCovered = (it: ScreenTextItem) =>
    covered.some((c) => Math.abs(c.x - it.x) < 2 && Math.abs(c.y - it.y) < 2);

  function lift(it: ScreenTextItem) {
    const canvas = getCanvas();
    const coverColor = canvas
      ? sampleBackgroundColor(canvas, it.x, it.y, it.width, it.height, VIEWER_WIDTH)
      : "#ffffff";

    addEdit(
      makeTextEdit({
        pageIndex,
        x: it.x,
        y: it.y,
        width: Math.max(it.width + 8, 40),
        height: Math.max(it.height, 16),
        text: it.str,
        fontSize: it.fontSize,
        fontFamily: it.fontFamily,
        bold: it.bold,
        italic: it.italic,
        color: "#111827",
        origin: "existing",
        coverColor,
        // Lock the cover to the original glyph box so dragging the edit away
        // doesn't re-expose the original text. Pad to hide descenders/edges.
        coverRect: {
          x: it.x - 2,
          y: it.y - 2,
          width: it.width + 4,
          height: it.height + 4,
        },
      }),
    );
  }

  return (
    <div className="existing-text-layer">
      {items.map((it) =>
        isCovered(it) ? null : (
          <button
            key={it.id}
            type="button"
            className="existing-text-hit"
            title="Click to edit this text"
            style={{
              left: it.x,
              top: it.y,
              width: it.width,
              height: it.height,
              fontSize: it.fontSize,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              lift(it);
            }}
          >
            <span>{it.str}</span>
          </button>
        ),
      )}
    </div>
  );
}
