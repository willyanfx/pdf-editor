import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { useVirtualizer } from "@tanstack/react-virtual";
import { UploadCloud, Loader2 } from "lucide-react";
import { EditableLayer } from "./EditableLayer";
import { ExistingTextLayer } from "./ExistingTextLayer";
import { OcrLayer } from "./OcrLayer";
import { useEditorStore, makeCoverTextEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { openFiles } from "../lib/openFiles";
import { sampleBackgroundColor } from "../lib/textLayer";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";
import { usePageHeights } from "../hooks/usePageHeights";

/** Vertical gap between page shells, reserved inside each virtual slot. */
const PAGE_GAP = 24;
/** Estimated page height used before real measurements arrive (US Letter). */
const ESTIMATED_PAGE_HEIGHT = Math.round((VIEWER_WIDTH * 11) / 8.5);
/** Pages to keep mounted beyond the viewport. Generous so edit/OCR canvases for
 * nearby pages stay alive and a page being OCR'd isn't unmounted mid-run. */
const OVERSCAN = 3;

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Load the worker bundled with our single pdfjs-dist copy so the worker version
// always matches the API version react-pdf was built against.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PdfViewer() {
  // `file` is a stable reference (changes only when a new PDF is opened), so
  // react-pdf won't re-load on every render.
  const file = useEditorStore((s) => s.file);
  const setSelectedPageIndex = useEditorStore((s) => s.setSelectedPageIndex);
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const mode = useEditorStore((s) => s.mode);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const ocrProgress = useEditorStore((s) => s.ocrProgress);
  const ocrRequestPageIndex = useEditorStore((s) => s.ocrRequestPageIndex);
  const requestOcrPage = useEditorStore((s) => s.requestOcrPage);
  const setOcrBusy = useEditorStore((s) => s.setOcrBusy);
  const setOcrProgress = useEditorStore((s) => s.setOcrProgress);
  const addEdit = useEditorStore((s) => s.addEdit);
  const numPages = useEditorStore((s) => s.numPages);
  const setNumPages = useEditorStore((s) => s.setNumPages);
  const setScrollToPage = useEditorStore((s) => s.setScrollToPage);
  const addToast = useToastStore((s) => s.addToast);

  // Per-page pdf.js page proxies (for text extraction) and canvas refs (for
  // background-color sampling). Stored outside React state to avoid re-renders.
  const pagesRef = useRef<Map<number, PDFPageProxy>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement | null>>(new Map());
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Bump to re-render once a page proxy lands so ExistingTextLayer gets it.
  const [, force] = useState(0);

  // Measure page heights cheaply (no rasterization) so the virtualizer can size
  // every page accurately before its canvas renders — keeps the scrollbar stable.
  const pageHeights = usePageHeights(file, numPages);

  const estimateSize = useCallback(
    (index: number) => (pageHeights[index] ?? ESTIMATED_PAGE_HEIGHT) + PAGE_GAP,
    [pageHeights],
  );

  const virtualizer = useVirtualizer({
    count: numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  // Re-measure when real heights arrive so offsets settle onto exact values.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, pageHeights]);

  // Let the top bar's page nav jump to any page, even an unmounted one.
  useEffect(() => {
    setScrollToPage((pageIndex) =>
      virtualizer.scrollToIndex(pageIndex, { align: "start" }),
    );
    return () => setScrollToPage(null);
  }, [virtualizer, setScrollToPage]);

  const virtualItems = virtualizer.getVirtualItems();

  // Keep the top-bar page readout in sync with scroll: the "current" page is the
  // first visible one — the first virtual item whose bottom edge is past the
  // scroll offset (virtualItems lead the viewport by `overscan`, so we can't just
  // take the first one).
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  const topVisibleIndex =
    virtualItems.find((it) => it.start + it.size > scrollOffset)?.index ??
    virtualItems[0]?.index ??
    0;
  useEffect(() => {
    if (numPages > 0) setSelectedPageIndex(topVisibleIndex);
  }, [topVisibleIndex, numPages, setSelectedPageIndex]);

  // Whole-page OCR: the toolbar sets ocrRequestPageIndex; we own the page
  // canvases, so we run the recognition here and clear the request when done.
  useEffect(() => {
    if (ocrRequestPageIndex == null) return;
    const pageIndex = ocrRequestPageIndex;
    const canvas = canvasRefs.current.get(pageIndex);
    if (!canvas) {
      requestOcrPage(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      setOcrBusy(true);
      setOcrProgress(0);
      try {
        const { recognizePageRegion } = await import("../lib/ocr");
        const items = await recognizePageRegion(canvas, VIEWER_WIDTH, undefined, setOcrProgress);
        if (cancelled) return;
        for (const it of items) {
          const coverColor = sampleBackgroundColor(
            canvas,
            it.x,
            it.y,
            it.width,
            it.height,
            VIEWER_WIDTH,
          );
          addEdit(makeCoverTextEdit(it, pageIndex, coverColor));
        }
        addToast(items.length ? "Text recognized" : "No text found on this page", "info");
      } catch {
        if (!cancelled) {
          addToast("Could not recognize text on this page.", "error");
        }
      } finally {
        setOcrBusy(false);
        setOcrProgress(0);
        // Consume the request AFTER the work so resetting the dependency doesn't
        // cancel our own in-flight run (the reset re-fires the effect, which then
        // returns early because the index is null again).
        requestOcrPage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrRequestPageIndex]);

  if (!file) {
    return (
      <section className="empty">
        <h1>Browser PDF Editor</h1>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(event) => {
            openFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button type="button" className="dropzone" onClick={() => pdfInputRef.current?.click()}>
          <UploadCloud size={48} className="dropzone-icon" />
          <span className="dropzone-title">Drop a PDF here</span>
          <span className="dropzone-sub muted">or click to browse</span>
        </button>
        <p className="muted">No backend. No upload. Your files never leave your browser.</p>
      </section>
    );
  }

  return (
    <section ref={scrollRef} className={`pdf-wrapper mode-${mode}`}>
      <Document
        file={file}
        onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
        loading={<p className="muted">Loading PDF…</p>}
        error={<p className="muted">Could not open this PDF.</p>}
      >
        {/* Spacer sized to all pages; only the windowed pages below are mounted,
            each absolutely positioned at its virtual offset. */}
        <div
          className="pdf-virtual-spacer"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((item) => {
            const index = item.index;
            return (
              <div
                className="page-shell"
                key={item.key}
                data-page-index={index}
                data-index={index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  // Reserve the inter-page gap inside the slot the virtualizer
                  // sized (estimateSize adds PAGE_GAP), so pages don't overlap.
                  height: item.size - PAGE_GAP,
                  width: VIEWER_WIDTH,
                  transform: `translate(-50%, ${item.start}px)`,
                }}
                onMouseDown={() => {
                  setSelectedPageIndex(index);
                  selectEdit(null);
                }}
              >
                <Page
                  pageNumber={index + 1}
                  width={VIEWER_WIDTH}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  canvasRef={(el) => {
                    canvasRefs.current.set(index, el);
                  }}
                  onLoadSuccess={(page) => {
                    pagesRef.current.set(index, page as unknown as PDFPageProxy);
                    force((n) => n + 1);
                  }}
                />
                <ExistingTextLayer
                  pageIndex={index}
                  page={pagesRef.current.get(index) ?? null}
                  getCanvas={() => canvasRefs.current.get(index) ?? null}
                />
                <OcrLayer
                  pageIndex={index}
                  getCanvas={() => canvasRefs.current.get(index) ?? null}
                />
                <EditableLayer pageIndex={index} />
              </div>
            );
          })}
        </div>
      </Document>

      {ocrBusy && (
        <div className="ocr-overlay" role="status" aria-live="polite">
          <div className="ocr-overlay-card">
            <Loader2 size={20} className="ocr-spinner" />
            <span>Reading text… {Math.round(ocrProgress * 100)}%</span>
          </div>
        </div>
      )}
    </section>
  );
}
