import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { useEditorStore, makeTextEdit, textToRuns } from "../store/useEditorStore";
import {
  extractScreenTextItems,
  sampleBackgroundColor,
  type ScreenTextItem,
} from "../lib/textLayer";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";
import { cssFontFamily, ensureFontLoaded, waitForFonts } from "../lib/fonts";

/** Which character of `it.str` sits under a click at `clientX`, so the lifted
 * editor can drop its caret there (Acrobat-style click-to-edit). Measured with
 * an offscreen canvas; off-by-one is acceptable when the web font differs from
 * the original embedded glyphs. */
function computeCaretOffset(it: ScreenTextItem, clientX: number, buttonEl: HTMLElement): number {
  const rect = buttonEl.getBoundingClientRect();
  const relX = clientX - rect.left;
  if (relX <= 0) return 0;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${it.italic ? "italic " : ""}${it.bold ? "bold " : ""}${it.fontSize}px ${cssFontFamily(it.fontFamily)}`;
  const str = it.str;
  let i = 0;
  while (i < str.length) {
    if (ctx.measureText(str.slice(0, i + 1)).width > relX) break;
    i++;
  }
  return i;
}

/** The sub-run of a grouped block under a click at `clientX` (Alt+click path). */
function pickSubItem(
  it: ScreenTextItem,
  clientX: number,
  buttonEl: HTMLElement,
): ScreenTextItem | null {
  if (!it.subItems) return null;
  const rect = buttonEl.getBoundingClientRect();
  const relX = clientX - rect.left; // px from the block's left edge
  for (const sub of it.subItems) {
    const left = sub.x - it.x;
    if (relX >= left && relX <= left + sub.width) return sub;
  }
  return it.subItems[0] ?? null;
}

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
  const setPendingFocus = useEditorStore((s) => s.setPendingFocus);
  const edits = useEditorStore((s) => s.edits);
  const [items, setItems] = useState<ScreenTextItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!page) {
      setItems([]);
      return;
    }
    void extractScreenTextItems(page, VIEWER_WIDTH).then(async (result) => {
      if (cancelled) return;
      // Ensure font CSS is injected and the faces are loaded before exposing
      // items, so computeCaretOffset canvas measurement uses real glyph metrics.
      const families = [...new Set(result.map((it) => it.fontFamily))];
      for (const f of families) ensureFontLoaded(f);
      await waitForFonts(families);
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
  // A block is "covered" once a lifted edit's cover rectangle overlaps it, so we
  // hide it (the edit now stands in for it). bbox overlap, not point-match, so a
  // grouped line stays hidden even though its x differs from the original runs.
  const isCovered = (it: ScreenTextItem) =>
    covered.some(
      (c) =>
        c.type === "text" &&
        c.coverRect != null &&
        c.coverRect.x < it.x + it.width &&
        c.coverRect.x + c.coverRect.width > it.x &&
        c.coverRect.y < it.y + it.height &&
        c.coverRect.y + c.coverRect.height > it.y,
    );

  function lift(it: ScreenTextItem, caretOffset: number) {
    const canvas = getCanvas();
    const coverColor = canvas
      ? sampleBackgroundColor(canvas, it.x, it.y, it.width, it.height, VIEWER_WIDTH)
      : "#ffffff";

    const edit = makeTextEdit({
      pageIndex,
      x: it.x,
      y: it.y,
      width: Math.max(it.width + 8, 40),
      height: Math.max(it.height, 16),
      runs: it.runs ?? textToRuns(it.str, { bold: it.bold || undefined, italic: it.italic || undefined }),
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
    });
    addEdit(edit);
    // Tell the freshly-mounted editor to focus and drop the caret where clicked.
    setPendingFocus({ editId: edit.id, caretOffset });
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
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              // Alt+click lifts just the original run under the cursor, opting out
              // of line grouping (useful for tables / mixed layouts).
              const target =
                e.altKey && it.subItems
                  ? (pickSubItem(it, e.clientX, e.currentTarget) ?? it)
                  : it;
              lift(target, computeCaretOffset(target, e.clientX, e.currentTarget));
            }}
          >
            <span>{it.str}</span>
          </button>
        ),
      )}
    </div>
  );
}
