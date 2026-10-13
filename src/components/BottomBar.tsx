import { useEffect, useMemo, useRef, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  BookOpen,
  Maximize,
  Minimize,
} from "lucide-react";
import { useEditorStore, MIN_ZOOM, MAX_ZOOM } from "../store/useEditorStore";
import { useViewerStore } from "../store/useViewerStore";
import { fullscreenSupported, toggleFullscreen } from "../lib/fullscreen";
import { buildPageRows, stepPage, visiblePages } from "../lib/pageLayout";

/** Discrete zoom levels offered in the dropdown, alongside the fit presets. */
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Floating view controls over the canvas: page navigation, zoom, page layout. */
export function BottomBar() {
  const file = useEditorStore((s) => s.file);
  const numPages = useEditorStore((s) => s.numPages);
  const selectedPageIndex = useEditorStore((s) => s.selectedPageIndex);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const setSelectedPageIndex = useEditorStore((s) => s.setSelectedPageIndex);
  // Routes through the virtualizer in PdfViewer: a target page may not be mounted,
  // so a DOM scrollIntoView can't reach it.
  const scrollToPage = useEditorStore((s) => s.scrollToPage);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomPreset = useEditorStore((s) => s.zoomPreset);
  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setZoomPreset = useEditorStore((s) => s.setZoomPreset);
  const pageLayout = useViewerStore((s) => s.pageLayout);
  const coverPage = useViewerStore((s) => s.coverPage);
  const fullscreen = useViewerStore((s) => s.fullscreen);
  const setPageLayout = useViewerStore((s) => s.setPageLayout);
  const setCoverPage = useViewerStore((s) => s.setCoverPage);
  const twoPage = pageLayout === "two";

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Draft text for the page-jump input; null means "mirror the live page".
  const [pageDraft, setPageDraft] = useState<string | null>(null);

  const rows = useMemo(
    () => buildPageRows(visiblePages(numPages, pageOrder), pageLayout, coverPage),
    [numPages, pageOrder, pageLayout, coverPage],
  );

  function goToPage(index: number) {
    if (index < 0 || index >= numPages) return;
    setSelectedPageIndex(index);
    scrollToPage?.(index);
  }

  /** The page the previous/next controls lead to: a row away, skipping pages the
   * organizer removed (two-page view moves two pages at a time). */
  function adjacentPage(direction: 1 | -1): number | null {
    return stepPage(rows, selectedPageIndex, direction);
  }

  function stepToPage(direction: 1 | -1) {
    const target = adjacentPage(direction);
    if (target !== null) goToPage(target);
  }

  function commitPageDraft() {
    if (pageDraft === null) return;
    const n = parseInt(pageDraft, 10);
    if (!Number.isNaN(n)) goToPage(Math.min(Math.max(n, 1), numPages) - 1);
    setPageDraft(null); // snap back to mirroring the live page
  }

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Handled: the app-level Escape (leave tool / deselect) must not also fire.
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!file) return null;

  // When a preset is active, show its name; otherwise the numeric percentage.
  const label =
    zoomPreset === "fit-width"
      ? "Fit width"
      : zoomPreset === "fit-page"
        ? "Fit page"
        : `${Math.round(zoom * 100)}%`;

  return (
    <div className="bottombar" role="toolbar" aria-label="View controls">
      {numPages > 0 && (
        <>
          <div className="bottombar-pages">
            <button
              type="button"
              className="bottombar-btn"
              aria-label="Previous page"
              title="Previous page"
              disabled={adjacentPage(-1) === null}
              onClick={() => stepToPage(-1)}
            >
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <form
              className="bottombar-page-info"
              onSubmit={(e) => {
                e.preventDefault();
                commitPageDraft();
                (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.blur();
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                className="bottombar-page-input"
                aria-label="Page number"
                value={pageDraft ?? String(selectedPageIndex + 1)}
                onChange={(e) => setPageDraft(e.target.value.replace(/[^0-9]/g, ""))}
                onFocus={(e) => e.target.select()}
                onBlur={commitPageDraft}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    stepToPage(-1);
                    setPageDraft(null);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    stepToPage(1);
                    setPageDraft(null);
                  } else if (e.key === "Escape") {
                    setPageDraft(null);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <span>of {numPages}</span>
            </form>
            <button
              type="button"
              className="bottombar-btn"
              aria-label="Next page"
              title="Next page"
              disabled={adjacentPage(1) === null}
              onClick={() => stepToPage(1)}
            >
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
          <span className="bottombar-sep" aria-hidden="true" />
        </>
      )}

      <div className="bottombar-zoom" ref={menuRef}>
        <button
          type="button"
          className="bottombar-btn"
          aria-label="Zoom out"
          title="Zoom out (⌘−)"
          disabled={zoom <= MIN_ZOOM}
          onClick={zoomOut}
        >
          <ZoomOut size={17} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="bottombar-zoom-level"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Set zoom level"
          onClick={() => setOpen((v) => !v)}
        >
          <span>{label}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>

        {open && (
          <div className="bottombar-zoom-menu" role="menu">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={zoomPreset === "fit-width"}
              className={zoomPreset === "fit-width" ? "is-active" : undefined}
              onClick={() => {
                setZoomPreset("fit-width");
                setOpen(false);
              }}
            >
              <span>Fit width</span>
              <kbd className="bottombar-zoom-kbd">W</kbd>
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={zoomPreset === "fit-page"}
              className={zoomPreset === "fit-page" ? "is-active" : undefined}
              onClick={() => {
                setZoomPreset("fit-page");
                setOpen(false);
              }}
            >
              <span>Fit page</span>
              <kbd className="bottombar-zoom-kbd">P</kbd>
            </button>
            <div className="bottombar-zoom-menu-sep" role="separator" />
            {ZOOM_LEVELS.map((z) => (
              <button
                key={z}
                type="button"
                role="menuitemradio"
                aria-checked={!zoomPreset && Math.round(zoom * 100) === Math.round(z * 100)}
                className={
                  !zoomPreset && Math.round(zoom * 100) === Math.round(z * 100)
                    ? "is-active"
                    : undefined
                }
                onClick={() => {
                  setZoom(z);
                  setOpen(false);
                }}
              >
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="bottombar-btn"
          aria-label="Zoom in"
          title="Zoom in (⌘+)"
          disabled={zoom >= MAX_ZOOM}
          onClick={zoomIn}
        >
          <ZoomIn size={17} aria-hidden="true" />
        </button>
      </div>
      <span className="bottombar-sep" aria-hidden="true" />

      <div className="bottombar-view">
        <button
          type="button"
          className={"bottombar-btn" + (twoPage ? " is-active" : "")}
          aria-label="Two-page view"
          aria-pressed={twoPage}
          title="Two-page view"
          onClick={() => setPageLayout(twoPage ? "single" : "two")}
        >
          <Columns2 size={17} aria-hidden="true" />
        </button>
        {twoPage && (
          <button
            type="button"
            className={"bottombar-btn" + (coverPage ? " is-active" : "")}
            aria-label="Show cover page"
            aria-pressed={coverPage}
            title="Show cover page (first page alone)"
            onClick={() => setCoverPage(!coverPage)}
          >
            <BookOpen size={17} aria-hidden="true" />
          </button>
        )}
        {fullscreenSupported() && (
          <button
            type="button"
            className="bottombar-btn"
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen (F)"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? (
              <Minimize size={17} aria-hidden="true" />
            ) : (
              <Maximize size={17} aria-hidden="true" />
            )}
          </button>
        )}
      </div>

    </div>
  );
}
