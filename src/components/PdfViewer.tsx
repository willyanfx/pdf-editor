import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useVirtualizer } from "@tanstack/react-virtual";
import { UploadCloud } from "lucide-react";
import { EditableLayer } from "./EditableLayer";
import { ExistingTextLayer } from "./ExistingTextLayer";
import { ExistingImageLayer } from "./ExistingImageLayer";
import { OcrLayer } from "./OcrLayer";
import { SignatureZoneLayer } from "./SignatureZoneLayer";
import { AnnotateLayer } from "./AnnotateLayer";
import { RedactLayer } from "./RedactLayer";
import { InkLayer } from "./InkLayer";
import { TextDrawLayer } from "./TextDrawLayer";
import { PageStampsLayer } from "./PageStampsLayer";
import { PageActionsBar } from "./PageActionsBar";
import { SidePanel } from "./SidePanel";
import { loadOutlineIntoStore } from "../lib/outlineRead";
import { useEditorStore, makeCoverTextEdit, clampZoom } from "../store/useEditorStore";
import { useViewerStore } from "../store/useViewerStore";
import { useToastStore } from "../store/useToastStore";
import { openFiles } from "../lib/openFiles";
import { sampleBackgroundColor } from "../lib/textLayer";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";
import { PDF_DOCUMENT_OPTIONS } from "../lib/pdfOptions";
import { makeOnPassword } from "../lib/pdfPassword";
import { usePageHeights } from "../hooks/usePageHeights";
import { useScannedPdfPrompt } from "../hooks/useScannedPdfPrompt";
import { useFormFieldSync } from "../hooks/useFormFieldSync";
import { useHandTool } from "../hooks/useHandTool";
import { loadAttachments } from "../lib/attachments";
import { loadLayers } from "../lib/layers";
import {
  buildPageRows,
  firstPageOfRow,
  nearestShownPage,
  rowContentWidth,
  rowHeight,
  rowIndexOfPage,
  visiblePages,
} from "../lib/pageLayout";
import { goToLinkedPage, EXTERNAL_LINK_REL, EXTERNAL_LINK_TARGET } from "../lib/pdfLinks";

/** Vertical gap between page shells, reserved inside each virtual slot. */
const PAGE_GAP = 24;
/** Horizontal gutter between the two pages of a two-page row. */
const COLUMN_GAP = 24;
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
  const passwordAttempt = useEditorStore((s) => s.passwordAttempt);
  const setSelectedPageIndex = useEditorStore((s) => s.setSelectedPageIndex);
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const mode = useEditorStore((s) => s.mode);
  const ocrRequestPageIndex = useEditorStore((s) => s.ocrRequestPageIndex);
  const requestOcrPage = useEditorStore((s) => s.requestOcrPage);
  const ocrAllRequest = useEditorStore((s) => s.ocrAllRequest);
  const setOcrBusy = useEditorStore((s) => s.setOcrBusy);
  const setOcrProgress = useEditorStore((s) => s.setOcrProgress);
  const addEdit = useEditorStore((s) => s.addEdit);
  const numPages = useEditorStore((s) => s.numPages);
  const setNumPages = useEditorStore((s) => s.setNumPages);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const pageOps = useEditorStore((s) => s.pageOps);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const zoomPreset = useEditorStore((s) => s.zoomPreset);
  const setScrollToPage = useEditorStore((s) => s.setScrollToPage);
  const addToast = useToastStore((s) => s.addToast);
  const pageLayout = useViewerStore((s) => s.pageLayout);
  const coverPage = useViewerStore((s) => s.coverPage);
  const layerVersion = useViewerStore((s) => s.layerVersion);

  // Per-page pdf.js page proxies (for text extraction) and canvas refs (for
  // background-color sampling). Stored outside React state to avoid re-renders.
  // Each proxy is tagged with its File: after a page rewrite (insert, duplicate,
  // replace) swaps the File, the old document is destroyed and its proxies throw
  // on use, so getPage only hands out proxies from the file now open.
  const pagesRef = useRef<Map<number, { file: File | null; page: PDFPageProxy }>>(new Map());
  const getPage = (index: number) => {
    const entry = pagesRef.current.get(index);
    return entry && entry.file === file ? entry.page : null;
  };
  const canvasRefs = useRef<Map<number, HTMLCanvasElement | null>>(new Map());
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Bump to re-render once a page proxy lands so ExistingTextLayer gets it.
  const [, force] = useState(0);

  // Measure page heights cheaply (no rasterization) so the virtualizer can size
  // every page accurately before its canvas renders — keeps the scrollbar stable.
  const pageHeights = usePageHeights(file, numPages);

  // Nudge the user to run OCR when an opened PDF looks scanned (image-only).
  useScannedPdfPrompt(file);

  // The loaded pdf.js document, tagged with its File so a stale proxy from the
  // previous file is never handed to the form sync while the next one loads.
  const [loadedPdf, setLoadedPdf] = useState<{ file: File; pdf: PDFDocumentProxy } | null>(null);
  const currentPdf = loadedPdf && loadedPdf.file === file ? loadedPdf.pdf : null;
  useFormFieldSync(currentPdf, scrollRef);

  // What the document carries (attachments, layers) feeds the sidebar. Reset
  // while a new document loads so the previous one's don't linger.
  useEffect(() => {
    const viewer = useViewerStore.getState();
    viewer.setAttachments([]);
    viewer.setLayers(null);
    if (!currentPdf) return;
    let cancelled = false;
    void loadAttachments(currentPdf).then((list) => {
      if (!cancelled) useViewerStore.getState().setAttachments(list);
    });
    loadLayers(currentPdf)
      .then((state) => {
        if (!cancelled) useViewerStore.getState().setLayers(state);
      })
      .catch(() => {
        // Layers are optional; a document we can't read them from just has none.
      });
    return () => {
      cancelled = true;
    };
  }, [currentPdf]);

  // Hand tool (and Space-to-pan): dragging pans the stage instead of editing.
  const handActive = useHandTool(scrollRef, file);

  const pageHeightOf = useCallback(
    (pageIndex: number) => pageHeights[pageIndex] ?? ESTIMATED_PAGE_HEIGHT,
    [pageHeights],
  );

  // The stage scrolls in rows: one page each, or two side by side. Pages the
  // organizer removed aren't in any row, so neighbours close ranks.
  const rows = useMemo(
    () => buildPageRows(visiblePages(numPages, pageOrder), pageLayout, coverPage),
    [numPages, pageOrder, pageLayout, coverPage],
  );
  const columns = pageLayout === "two" ? 2 : 1;
  // A page turned a quarter-turn is as wide as it is tall, which would spill into
  // its neighbour across the narrow gutter; in two-page view every column is wide
  // enough for the widest rotated page, and pages sit centred in their column.
  const columnWidth = useMemo(() => {
    if (pageLayout !== "two") return VIEWER_WIDTH;
    let widest = VIEWER_WIDTH;
    for (const op of pageOps) {
      if (Math.abs(op.rotation) % 180 === 90) widest = Math.max(widest, pageHeightOf(op.pageIndex));
    }
    return Math.ceil(widest);
  }, [pageLayout, pageOps, pageHeightOf]);
  const contentWidth = rowContentWidth(columns, columnWidth, COLUMN_GAP);

  // The virtualizer works in real (on-screen) pixels — the units the scroll
  // container reports and scrolls in — so row sizes are scaled by zoom, which is
  // otherwise a CSS transform on the spacer. Pages are positioned at start/zoom
  // inside that scaled spacer.
  const estimateSize = useCallback(
    (rowIndex: number) => (rowHeight(rows[rowIndex] ?? [], pageHeightOf) + PAGE_GAP) * zoom,
    [rows, pageHeightOf, zoom],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  // Re-measure when real heights arrive, the rows regroup or zoom changes so offsets
  // settle onto exact values (the virtualizer doesn't notice a new estimateSize on
  // its own). A layout effect, so a zoom step never paints with the old offsets.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rows, pageHeights, zoom]);

  // Let the top bar's page nav jump to any page, even an unmounted one.
  useEffect(() => {
    setScrollToPage((pageIndex) => {
      let target = pageIndex;
      if (rowIndexOfPage(rows, pageIndex) < 0) {
        // A page the organizer removed: go to the closest one still shown, and
        // move the selection there so it never rests on a page that isn't.
        const nearest = nearestShownPage(rows, pageIndex);
        if (nearest === null) return;
        target = nearest;
        useEditorStore.getState().setSelectedPageIndex(nearest);
      }
      virtualizer.scrollToIndex(rowIndexOfPage(rows, target), { align: "start" });
    });
    return () => setScrollToPage(null);
  }, [virtualizer, rows, setScrollToPage]);

  // Two pages side by side overflow the stage at 100% on most screens, so entering
  // two-page view fits the width when that happens. The zoom it replaced is kept
  // so leaving two-page view puts it back (unless the user has changed zoom since).
  const autoFitFrom = useRef<number | null>(null);
  function fitWhenTwoPagesOverflow() {
    const el = scrollRef.current;
    const state = useEditorStore.getState();
    if (pageLayout !== "two" || !el || state.zoomPreset) return;
    if (contentWidth * state.zoom + 52 > el.clientWidth) {
      autoFitFrom.current = state.zoom;
      state.setZoomPreset("fit-width");
    }
  }
  function restoreZoomAfterAutoFit() {
    const from = autoFitFrom.current;
    autoFitFrom.current = null;
    const state = useEditorStore.getState();
    if (from !== null && state.zoomPreset === "fit-width") state.setZoom(from);
  }

  // A document opened while two-page view is the saved preference. Keyed on the
  // document finishing its load, not on the File: page inserts and duplicates swap
  // the File of a document that is already open, and must not re-fit.
  const loaded = numPages > 0;
  useEffect(() => {
    autoFitFrom.current = null;
    if (loaded) fitWhenTwoPagesOverflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Switching between single and two-page view regroups the rows, so the same
  // scroll offset would land on a different page. Keep the selected page in view,
  // and fit when two pages would overflow the stage.
  const layoutKey = `${pageLayout}:${coverPage}`;
  const lastLayoutKey = useRef(layoutKey);
  // Set while that scroll settles so the page readout doesn't follow the
  // in-between frames.
  const anchoring = useRef(false);
  useLayoutEffect(() => {
    if (lastLayoutKey.current === layoutKey) return;
    lastLayoutKey.current = layoutKey;
    virtualizer.measure();
    const state = useEditorStore.getState();
    const row = rowIndexOfPage(rows, state.selectedPageIndex);
    if (row >= 0) {
      anchoring.current = true;
      virtualizer.scrollToIndex(row, { align: "start" });
      window.setTimeout(() => {
        anchoring.current = false;
      }, 250);
    }
    if (pageLayout === "two") fitWhenTwoPagesOverflow();
    else restoreZoomAfterAutoFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, rows, virtualizer]);

  // Ctrl/⌘ + wheel zooms (matches Acrobat / browser PDF viewers / map UIs).
  // Registered non-passive so preventDefault() can suppress the browser's own
  // page zoom. Delta is normalized across the three WheelEvent deltaMode units
  // so a line/page-scrolling mouse zooms at the same rate as a pixel trackpad.
  // Depends on `file`: the scroll container only mounts once a doc is open, so
  // the effect must re-run then to attach to a non-null scrollRef.
  // NOTE: macOS hardware pinch-zoom (trackpad / Magic Mouse two-finger swipe)
  // arrives as a wheel event with ctrlKey synthesized — so this same handler
  // covers pinch-to-zoom. Plain ⌘+wheel is the explicit-key path.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1)
        delta *= 16; // DOM_DELTA_LINE → ~px per line
      else if (e.deltaMode === 2) delta *= 100; // DOM_DELTA_PAGE → ~px per page
      // Scroll up (negative delta) zooms in. Scale the step to wheel magnitude.
      const next = useEditorStore.getState().zoom - (delta / 100) * 0.1;
      setZoom(next);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom, file]);

  const virtualItems = virtualizer.getVirtualItems();

  // Keep the top-bar page readout in sync with scroll: the "current" page is the
  // first visible one — the first virtual item whose bottom edge is past the
  // scroll offset (virtualItems lead the viewport by `overscan`, so we can't just
  // take the first one).
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  // The 1px of slack absorbs scrollTop snapping to device pixels, which can land a
  // jump just short of the row's exact (fractional) start.
  const topRowIndex =
    virtualItems.find((it) => it.start + it.size > scrollOffset + 1)?.index ??
    virtualItems[0]?.index ??
    0;
  const topVisibleIndex = firstPageOfRow(rows[topRowIndex]) ?? 0;
  useEffect(() => {
    if (numPages === 0 || anchoring.current) return;
    // In two-page view the right-hand page can be the selected one; scrolling
    // within the same row shouldn't snap the selection back to the left page.
    if (rows[topRowIndex]?.includes(useEditorStore.getState().selectedPageIndex)) return;
    setSelectedPageIndex(topVisibleIndex);
  }, [topVisibleIndex, topRowIndex, rows, numPages, setSelectedPageIndex]);

  // Auto-fit zoom: when a preset is active, derive `zoom` from the live container
  // size and keep it updated as the window resizes. VIEWER_WIDTH is never touched
  // — only the presentational CSS zoom changes, so stored edit coordinates stay
  // valid. We write `zoom` via setState (not setZoom) so updating it doesn't clear
  // the preset and cancel the auto-fit.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !zoomPreset) return;

    function applyFit() {
      if (!el) return;
      // The observer can fire after the preset was cleared (e.g. leaving two-page
      // view restores a manual zoom) but before this effect is torn down; a stale
      // run must not overwrite that zoom.
      if (!useEditorStore.getState().zoomPreset) return;
      // clientWidth excludes the scrollbar; subtract the wrapper's 24px h-padding
      // (both sides) plus a small gutter so the page never butts the scrollbar.
      const availW = el.clientWidth - 48 - 4;
      const availH = el.clientHeight - 48;
      // A collapsed/zero-size container would produce a non-positive or infinite
      // fit; skip until it has real dimensions.
      if (availW <= 0) return;
      const fitWidth = availW / contentWidth;
      let next = fitWidth;
      if (zoomPreset === "fit-page" && availH > 0) {
        // Fit the currently-visible row (one page, or a two-page spread) fully in
        // view (width OR height bound). Read the live selection so a resize after
        // scrolling fits what is actually on screen, without re-subscribing the
        // observer.
        const state = useEditorStore.getState();
        const row = rows[rowIndexOfPage(rows, state.selectedPageIndex)];
        const pageH = row ? rowHeight(row, pageHeightOf) : ESTIMATED_PAGE_HEIGHT;
        if (pageH > 0) next = Math.min(fitWidth, availH / pageH);
      }
      useEditorStore.setState({ zoom: clampZoom(next) });
    }

    applyFit();
    const ro = new ResizeObserver(applyFit);
    ro.observe(el);
    return () => ro.disconnect();
    // topVisibleIndex is intentionally omitted: applyFit reads the live index via
    // getState(), so the observer needn't re-subscribe on every scroll. We keep
    // pageHeights so a late page measurement re-fits fit-page, and rows/contentWidth
    // so a layout switch re-fits.
  }, [zoomPreset, pageHeights, rows, contentWidth, pageHeightOf]);

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
        const { recognizeWithEngine } = await import("../lib/vlmOcr/dispatch");
        const engine = useEditorStore.getState().ocrEngine;
        let truncated = false;
        const items = await recognizeWithEngine(
          engine,
          canvas,
          VIEWER_WIDTH,
          undefined,
          setOcrProgress,
          () => {
            truncated = true;
          },
        );
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
        if (truncated) {
          addToast("This page is dense — only the top portion was recognized.", "error");
        } else {
          addToast(items.length ? "Text recognized" : "No text found on this page", "info");
        }
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
      const { recognizeWithEngine } = await import("../lib/vlmOcr/dispatch");
      const engine = useEditorStore.getState().ocrEngine;
      setOcrBusy(true);
      // Keep the loadingTask: destroying it (not the resolved doc) aborts a load
      // still in flight on cancel and fully tears down the worker doc.
      let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
      try {
        // Fresh buffer: pdf.js neuters the one it loads (same as usePageHeights).
        const data = await docFile.arrayBuffer();
        loadingTask = pdfjs.getDocument({ data, ...PDF_DOCUMENT_OPTIONS });
        const doc = await loadingTask.promise;
        const total = doc.numPages;
        useEditorStore.getState().setOcrAllProgress({ current: 0, total });

        const truncatedPages: number[] = [];
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
            await page.render({ canvas, viewport: scaled }).promise;
            const items = await recognizeWithEngine(
              engine,
              canvas,
              VIEWER_WIDTH,
              undefined,
              undefined,
              () => {
                truncatedPages.push(i);
              },
            );
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
          wasCancelled ? "Stopped OCR" : `OCR complete — ${total} pages read`,
          wasCancelled ? "info" : "success",
        );
        if (!wasCancelled && truncatedPages.length > 0) {
          const list =
            truncatedPages.length > 5
              ? `${truncatedPages.slice(0, 5).join(", ")}…`
              : truncatedPages.join(", ");
          addToast(
            `${truncatedPages.length} dense ${
              truncatedPages.length === 1 ? "page was" : "pages were"
            } only partially recognized (page ${list}).`,
            "error",
          );
        }
      } catch {
        if (!cancelled) addToast("Could not OCR this document.", "error");
      } finally {
        void loadingTask?.destroy();
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
    <section ref={scrollRef} className={`pdf-wrapper mode-${mode}${handActive ? " is-hand" : ""}`}>
      <Document
        // Re-key on each password attempt so react-pdf re-runs the load with the
        // newly stored password (it won't re-invoke onPassword otherwise).
        key={`doc-${passwordAttempt}`}
        file={file}
        options={PDF_DOCUMENT_OPTIONS}
        // Internal links / named destinations: react-pdf resolves the target
        // page and hands us its index; external URI links open in a new tab.
        onItemClick={({ pageIndex }) => goToLinkedPage(pageIndex)}
        externalLinkTarget={EXTERNAL_LINK_TARGET}
        externalLinkRel={EXTERNAL_LINK_REL}
        onPassword={makeOnPassword({
          getPassword: () => useEditorStore.getState().documentPassword,
          onNeedPassword: () => useEditorStore.getState().setPasswordPrompt({ wrong: false }),
          onIncorrect: () => {
            useEditorStore.getState().setDocumentPassword(null);
            useEditorStore.getState().setPasswordPrompt({ wrong: true });
          },
        })}
        onLoadSuccess={(pdf) => {
          // Reaching success means any password supplied was accepted — close
          // the unlock modal if it was open.
          useEditorStore.getState().setPasswordPrompt(null);
          setNumPages(pdf.numPages);
          void loadOutlineIntoStore(pdf, file);
          setLoadedPdf({ file, pdf });
        }}
        onLoadError={(err) => {
          // A PasswordException here means the modal is (or will be) up; don't
          // also toast a generic failure for it.
          if ((err as { name?: string })?.name === "PasswordException") return;
          console.error("PDF load failed:", err);
          addToast("Could not open this PDF.", "error");
        }}
        loading={<p className="muted">Loading PDF…</p>}
        error={<p className="muted">Could not open this PDF.</p>}
      >
        {pagePanelOpen && <SidePanel pdf={currentPdf} />}
        {/* Zoom sizer: reserves the scaled height so the scroll container scrolls
            the full zoomed document. The inner spacer is scaled from its top
            center — pages render at VIEWER_WIDTH (keeping every stored coordinate
            in that space) and zoom is purely presentational. */}
        <div
          className="pdf-zoom-sizer"
          style={{
            height: virtualizer.getTotalSize(),
            width: contentWidth * zoom,
          }}
        >
          {/* Spacer sized to all pages; only the windowed pages below are mounted,
              each absolutely positioned at its virtual offset. */}
          <div
            className="pdf-virtual-spacer"
            style={{
              height: virtualizer.getTotalSize() / zoom,
              width: contentWidth,
              transform: `translateX(-50%) scale(${zoom})`,
            }}
          >
            {virtualItems.flatMap((item) =>
              (rows[item.index] ?? []).map((pageIndex, column) => {
                if (pageIndex === null) return null;
                const index = pageIndex;
                const op = pageOps.find((o) => o.pageIndex === index);
                const rotation = op?.rotation ? ((op.rotation % 360) + 360) % 360 : 0;
                // Preview crop by clipping the page-shell to the kept region.
                const clip = op?.crop
                  ? `inset(${op.crop.top}px ${op.crop.right}px ${op.crop.bottom}px ${op.crop.left}px)`
                  : undefined;
                return (
                  <div
                    className="page-shell"
                    key={index}
                    data-page-index={index}
                    data-index={index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: column * (columnWidth + COLUMN_GAP) + (columnWidth - VIEWER_WIDTH) / 2,
                      // The page's own height; the row's slot also reserves the
                      // inter-page gap (estimateSize adds PAGE_GAP) and room for a
                      // taller partner, so rows never overlap.
                      height: pageHeightOf(index),
                      width: VIEWER_WIDTH,
                      transform: `translateY(${item.start / zoom}px)`,
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
                        // Re-keyed when a layer is shown/hidden so pdf.js repaints
                        // the canvas with the new visibility.
                        key={layerVersion}
                        pageNumber={index + 1}
                        width={VIEWER_WIDTH}
                        renderTextLayer={false}
                        // Links + fillable form widgets. Only interactive in Select
                        // mode; see the "Form fields + links" block in styles.css.
                        renderAnnotationLayer
                        renderForms
                        canvasRef={(el) => {
                          canvasRefs.current.set(index, el);
                        }}
                        onLoadSuccess={(page) => {
                          pagesRef.current.set(index, {
                            file,
                            page: page as unknown as PDFPageProxy,
                          });
                          force((n) => n + 1);
                        }}
                      />
                      <ExistingTextLayer
                        pageIndex={index}
                        page={getPage(index)}
                        getCanvas={() => canvasRefs.current.get(index) ?? null}
                      />
                      <ExistingImageLayer
                        pageIndex={index}
                        page={getPage(index)}
                        getCanvas={() => canvasRefs.current.get(index) ?? null}
                      />
                      <OcrLayer
                        pageIndex={index}
                        getCanvas={() => canvasRefs.current.get(index) ?? null}
                      />
                      <SignatureZoneLayer pageIndex={index} page={getPage(index)} />
                      <AnnotateLayer pageIndex={index} />
                      <RedactLayer pageIndex={index} page={getPage(index)} />
                      <InkLayer pageIndex={index} />
                      <TextDrawLayer pageIndex={index} />
                      <EditableLayer pageIndex={index} />
                      <PageStampsLayer pageIndex={index} page={getPage(index)} />
                    </div>
                    <PageActionsBar pageIndex={index} pageHeight={pageHeightOf(index)} />
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </Document>
    </section>
  );
}
