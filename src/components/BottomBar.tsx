import { ZoomIn, ZoomOut } from "lucide-react";
import { useEditorStore, MIN_ZOOM, MAX_ZOOM } from "../store/useEditorStore";

export function BottomBar() {
  const file = useEditorStore((s) => s.file);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const resetZoom = useEditorStore((s) => s.resetZoom);

  if (!file) return null;

  const pct = Math.round(zoom * 100);

  return (
    <footer className="bottombar">
      <div className="bottombar-zoom">
        <button
          type="button"
          className="bottombar-btn"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={zoomOut}
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          className="bottombar-zoom-level"
          title="Reset zoom to 100%"
          onClick={resetZoom}
        >
          {pct}%
        </button>
        <button
          type="button"
          className="bottombar-btn"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={zoomIn}
        >
          <ZoomIn size={15} />
        </button>
      </div>
    </footer>
  );
}
