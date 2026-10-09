import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, ChevronDown, Columns2, BookOpen, Maximize, Minimize } from "lucide-react";
import { useEditorStore, MIN_ZOOM, MAX_ZOOM } from "../store/useEditorStore";
import { useViewerStore } from "../store/useViewerStore";
import { fullscreenSupported, toggleFullscreen } from "../lib/fullscreen";

/** Discrete zoom levels offered in the dropdown, alongside the fit presets. */
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function BottomBar() {
  const file = useEditorStore((s) => s.file);
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

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The footer always renders so the layout's bottom grid row stays filled
  // (an empty row leaves the page stage's rounded bottom corners floating over
  // a blank strip — looks broken). The zoom controls, which need an open
  // document, are the only part gated on `file`.
  if (!file) return <footer className="bottombar" />;

  // When a preset is active, show its name; otherwise the numeric percentage.
  const label =
    zoomPreset === "fit-width"
      ? "Fit width"
      : zoomPreset === "fit-page"
        ? "Fit page"
        : `${Math.round(zoom * 100)}%`;

  return (
    <footer className="bottombar">
      <div className="bottombar-view">
        <button
          type="button"
          className={"bottombar-btn" + (twoPage ? " is-active" : "")}
          aria-label="Two-page view"
          aria-pressed={twoPage}
          title="Two-page view"
          onClick={() => setPageLayout(twoPage ? "single" : "two")}
        >
          <Columns2 size={15} aria-hidden="true" />
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
            <BookOpen size={15} aria-hidden="true" />
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
              <Minimize size={15} aria-hidden="true" />
            ) : (
              <Maximize size={15} aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      <span className="bottombar-sep" aria-hidden="true" />

      <div className="bottombar-zoom" ref={menuRef}>
        <button
          type="button"
          className="bottombar-btn"
          aria-label="Zoom out"
          title="Zoom out (⌘−)"
          disabled={zoom <= MIN_ZOOM}
          onClick={zoomOut}
        >
          <ZoomOut size={15} aria-hidden="true" />
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
          <ZoomIn size={15} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
