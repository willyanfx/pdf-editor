import { useEffect, useState } from "react";
import { pdfjs } from "react-pdf";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";
import { PDF_DOCUMENT_OPTIONS } from "../lib/pdfOptions";

/**
 * Measure every page's on-screen height (at VIEWER_WIDTH) without rasterizing
 * the pages. The virtualizer needs accurate per-page sizes up front so the
 * scrollbar and page offsets don't jump as real pages render in. pdf.js gives us
 * each page's viewport (a cheap metadata read) — far cheaper than mounting a
 * <Page> canvas, so we can do it for all pages of even a large PDF at load.
 *
 * Returns an array of heights indexed by page (empty until measured). Falls back
 * to an A4-ish aspect ratio for any page we couldn't measure.
 */
const FALLBACK_HEIGHT = Math.round((VIEWER_WIDTH * 11) / 8.5); // US Letter aspect

export function usePageHeights(file: File | null, numPages: number): number[] {
  const [heights, setHeights] = useState<number[]>([]);

  useEffect(() => {
    if (!file) {
      setHeights([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // Read fresh bytes: pdf.js neuters the ArrayBuffer it loads, and the
        // render path consumes its own copy, so we hand this a separate buffer.
        const data = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data, ...PDF_DOCUMENT_OPTIONS }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }

        const measured: number[] = new Array(doc.numPages).fill(FALLBACK_HEIGHT);
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) break;
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          measured[i - 1] = (VIEWER_WIDTH / vp.width) * vp.height;
          page.cleanup();
        }
        void doc.destroy();
        if (!cancelled) setHeights(measured);
      } catch {
        // On failure, leave heights empty so the caller uses its estimate.
        if (!cancelled) setHeights([]);
      }
    })();

    return () => {
      cancelled = true;
    };
    // numPages is included so a re-measure can be triggered if it changes for the
    // same File reference (it normally won't, but keeps the data consistent).
  }, [file, numPages]);

  return heights;
}
