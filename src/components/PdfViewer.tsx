import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { useVirtualizer } from "@tanstack/react-virtual";
import { UploadCloud, Loader2 } from "lucide-react";
import { EditableLayer } from "./EditableLayer";
import { ExistingTextLayer } from "./ExistingTextLayer";
import { ExistingImageLayer } from "./ExistingImageLayer";
import { OcrLayer } from "./OcrLayer";
import { AnnotateLayer } from "./AnnotateLayer";
import { InkLayer } from "./InkLayer";
import { PageActionsBar } from "./PageActionsBar";
import { PagePanel } from "./PagePanel";
import { useEditorStore, makeCoverTextEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { openFiles } from "../lib/openFiles";
import { sampleBackgroundColor } from "../lib/textLayer";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";
import { PDF_DOCUMENT_OPTIONS } from "../lib/pdfOptions";
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

// Worker + wasm config lives in pdfOptions (imported above for its side effect of
// setting GlobalWorkerOptions.workerSrc, and for PDF_DOCUMENT_OPTIONS).

type PdfViewerProps = {
  /** Whether the page-organizer thumbnail sidebar is shown. */
  pagePanelOpen?: boolean;
};

export function PdfViewer({ pagePanelOpen = false }: PdfViewerProps) {
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
  const ocrAllRequest = useEditorStore((s) => s.ocrAllRequest);
  const ocrAllProgress = useEditorStore((s) => s.ocrAllProgress);
  const setOcrBusy = useEditorStore((s) => s.setOcrBusy);
  const setOcrProgress = useEditorStore((s) => s.setOcrProgress);
  const addEdit = useEditorStore((s) => s.addEdit);
  const numPages = useEditorStore((s) => s.numPages);
  const setNumPages = useEditorStore((s) => s.setNumPages);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const pageOps = useEditorStore((s) => s.pageOps);
  const zoom = useEditorStore((s) => s.zoom);
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
    setScrollToPage((pageIndex) => virtualizer.scrollToIndex(pageIndex, { align: "start" }));
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

  // Whole-document OCR: render every page off-screen (we can't rely on the
  // virtualizer's canvases — most pages aren't mounted) and OCR them in order.
  useEffect(() => {
    if (!ocrAllRequest) return;
    const store = useEditorStore.getState();
    const docFile = store.file;
    if (!docFile) {
      store.clearOcrAll();
      return;
    }

    let cancelled = false;
    void (async () => {
      const { pdfjs } = await import("react-pdf");
      const { recognizePageRegion } = await import("../lib/ocr");
      setOcrBusy(true);
      let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]> | null = null;
      try {
        // Fresh buffer: pdf.js neuters the one it loads (same as usePageHeights).
        const data = await docFile.arrayBuffer();
        doc = await pdfjs.getDocument({ data, ...PDF_DOCUMENT_OPTIONS }).promise;
        const total = doc.numPages;
        useEditorStore.getState().setOcrAllProgress({ current: 0, total });

        for (let i = 1; i <= total; i++) {
          if (cancelled || useEditorStore.getState().ocrAllCancelled) break;
          useEditorStore.getState().setOcrAllProgress({ current: i, total });
          try {
            const page = await doc.getPage(i);
            const vp = page.getViewport({ scale: 1 });
            const scale = VIEWER_WIDTH / vp.width;
            const scaled = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(scaled.width);
            canvas.height = Math.ceil(scaled.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              page.cleanup();
              continue;
            }
            await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
            const items = await recognizePageRegion(canvas, VIEWER_WIDTH, undefined);
            if (cancelled || useEditorStore.getState().ocrAllCancelled) {
              page.cleanup();
              break;
            }
            for (const it of items) {
              const coverColor = sampleBackgroundColor(
                canvas,
                it.x,
                it.y,
                it.width,
                it.height,
                VIEWER_WIDTH,
              );
              addEdit(makeCoverTextEdit(it, i - 1, coverColor));
            }
            page.cleanup();
            // Release the canvas before the next page so memory stays bounded.
            canvas.width = canvas.height = 0;
          } catch {
            // One bad page shouldn't abort the whole run.
            // eslint-disable-next-line no-console
            console.warn(`OCR failed on page ${i}`);
          }
        }
        const wasCancelled = cancelled || useEditorStore.getState().ocrAllCancelled;
        addToast(
          wasCancelled ? "Stopped OCR" : `OCR complete — ${doc.numPages} pages read`,
          wasCancelled ? "info" : "success",
        );
      } catch {
        if (!cancelled) addToast("Could not OCR this document.", "error");
      } finally {
        if (doc) void doc.destroy();
        setOcrBusy(false);
        useEditorStore.getState().clearOcrAll();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrAllRequest]);

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
        options={PDF_DOCUMENT_OPTIONS}
        onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
        onLoadError={(err) => {
          console.error("PDF load failed:", err);
          addToast("Could not open this PDF.", "error");
        }}
        loading={<p className="muted">Loading PDF…</p>}
        error={<p className="muted">Could not open this PDF.</p>}
      >
        {pagePanelOpen && <PagePanel onClose={() => {}} />}
        {/* Zoom sizer: reserves the scaled height so the scroll container scrolls
            the full zoomed document. The inner spacer is scaled from its top
            center — pages render at VIEWER_WIDTH (keeping every stored coordinate
            in that space) and zoom is purely presentational. */}
        <div
          className="pdf-zoom-sizer"
          style={{
            height: virtualizer.getTotalSize() * zoom,
            width: VIEWER_WIDTH * zoom,
          }}
        >
          {/* Spacer sized to all pages; only the windowed pages below are mounted,
              each absolutely positioned at its virtual offset. */}
          <div
            className="pdf-virtual-spacer"
            style={{
              height: virtualizer.getTotalSize(),
              width: VIEWER_WIDTH,
              transform: `translateX(-50%) scale(${zoom})`,
            }}
          >
            {virtualItems.map((item) => {
              const index = item.index;
              // Pages removed in the organizer are dropped from the view too.
              const deleted = pageOrder.length > 0 && !pageOrder.includes(index);
              if (deleted) return null;
              const op = pageOps.find((o) => o.pageIndex === index);
              const rotation = op?.rotation ? ((op.rotation % 360) + 360) % 360 : 0;
              // Preview crop by clipping the page-shell to the kept region.
              const clip = op?.crop
                ? `inset(${op.crop.top}px ${op.crop.right}px ${op.crop.bottom}px ${op.crop.left}px)`
                : undefined;
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
                  <div
                    className="page-transform"
                    style={{
                      transform: rotation ? `rotate(${rotation}deg)` : undefined,
                      clipPath: clip,
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
                    <ExistingImageLayer
                      pageIndex={index}
                      page={pagesRef.current.get(index) ?? null}
                      getCanvas={() => canvasRefs.current.get(index) ?? null}
                    />
                    <OcrLayer
                      pageIndex={index}
                      getCanvas={() => canvasRefs.current.get(index) ?? null}
                    />
                    <AnnotateLayer pageIndex={index} />
                    <InkLayer pageIndex={index} />
                    <EditableLayer pageIndex={index} />
                  </div>
                  <PageActionsBar
                    pageIndex={index}
                    pageHeight={pageHeights[index] ?? ESTIMATED_PAGE_HEIGHT}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </Document>

      {ocrBusy && (
        <div className="ocr-overlay" role="status" aria-live="polite">
          <div className="ocr-overlay-card">
            <Loader2 size={20} className="ocr-spinner" />
            {ocrAllProgress ? (
              <>
                <span>
                  Reading page {ocrAllProgress.current} of {ocrAllProgress.total}…
                </span>
                <button
                  type="button"
                  className="ocr-cancel"
                  onClick={() => useEditorStore.getState().cancelOcrAll()}
                >
                  Cancel
                </button>
              </>
            ) : (
              <span>Reading text… {Math.round(ocrProgress * 100)}%</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
