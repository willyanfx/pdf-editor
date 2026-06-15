import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { useEditorStore, makeCoverImageEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { sampleBackgroundColor } from "../lib/textLayer";
import { fileToDataUrl } from "../lib/file";
import { extractScreenImageItems, type ScreenImageItem } from "../lib/imageLayer";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";

type Props = {
  pageIndex: number;
  page: PDFPageProxy | null;
  getCanvas: () => HTMLCanvasElement | null;
};

/**
 * In "editText" mode, overlay clickable hit targets on each image already
 * embedded in the page. Clicking one covers the original pixels with a sampled
 * color and prompts for a replacement image (mirrors ExistingTextLayer for text).
 */
export function ExistingImageLayer({ pageIndex, page, getCanvas }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const addEdit = useEditorStore((s) => s.addEdit);
  const edits = useEditorStore((s) => s.edits);
  const addToast = useToastStore((s) => s.addToast);
  const [items, setItems] = useState<ScreenImageItem[]>([]);

  const active = mode === "editText";

  useEffect(() => {
    if (!active || !page) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void extractScreenImageItems(page)
      .then((found) => {
        if (!cancelled) setItems(found);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, page]);

  if (!active || items.length === 0) return null;

  // Hide a hit target once a covering edit already overlaps it on this page.
  const covered = (item: ScreenImageItem) =>
    edits.some(
      (e) =>
        e.type === "image" &&
        e.origin === "existing" &&
        e.pageIndex === pageIndex &&
        e.coverRect &&
        Math.abs(e.coverRect.x - item.x) < 4 &&
        Math.abs(e.coverRect.y - item.y) < 4,
    );

  function onPick(item: ScreenImageItem) {
    const canvas = getCanvas();
    const coverColor = canvas
      ? sampleBackgroundColor(canvas, item.x, item.y, item.width, item.height, VIEWER_WIDTH)
      : "#ffffff";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.onchange = async () => {
      const picked = input.files?.[0];
      if (!picked) return;
      try {
        const dataUrl = await fileToDataUrl(picked);
        addEdit(makeCoverImageEdit(item, pageIndex, dataUrl, coverColor));
      } catch {
        addToast("Could not decode that image.", "error");
      }
    };
    input.click();
  }

  return (
    <div className="existing-image-layer">
      {items.map((item, i) =>
        covered(item) ? null : (
          <button
            key={i}
            type="button"
            className="existing-image-hit"
            title="Replace this image"
            style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onPick(item);
            }}
          />
        ),
      )}
    </div>
  );
}
