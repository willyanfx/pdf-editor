import { useState } from "react";
import { Stamp, PanelTop, Hash, Fingerprint, Droplets, X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { RailButton } from "./RailButton";

/**
 * Tool-rail entry for document-wide stamps: header & footer (page numbers,
 * Bates numbers) and watermark. A small popover routes to the two dialogs.
 */
export function StampsMenu() {
  const [open, setOpen] = useState(false);
  const file = useEditorStore((s) => s.file);
  const hfOn = useEditorStore((s) => !!s.pageStamps.headerFooter);
  const wmOn = useEditorStore((s) => !!s.pageStamps.watermark);
  const { openHeaderFooter, openWatermark } = useEditorActions();
  const close = () => setOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, close);

  const run = (fn: () => void) => {
    close();
    fn();
  };

  return (
    <div className="ocr-menu-anchor">
      <RailButton
        icon={<Stamp size={18} />}
        tip="Header, footer & watermark"
        active={open}
        toggle
        disabled={!file}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <>
          <div className="palette-backdrop" style={{ background: "transparent" }} onClick={close} />
          <div
            ref={trapRef}
            className="ocr-menu-popover"
            role="dialog"
            aria-modal="false"
            aria-label="Header, footer and watermark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sig-header">
              <span>Stamp every page</span>
              <button type="button" className="sig-close" onClick={close} aria-label="Close menu">
                <X size={16} />
              </button>
            </div>
            <button
              type="button"
              className="ocr-scope-btn"
              onClick={() => run(() => openHeaderFooter())}
            >
              <PanelTop size={15} aria-hidden="true" />
              Header &amp; footer…
              {hfOn && <span className="stamp-on">On</span>}
            </button>
            <button
              type="button"
              className="ocr-scope-btn"
              onClick={() => run(() => openHeaderFooter("page-of"))}
            >
              <Hash size={15} aria-hidden="true" />
              Add page numbers…
            </button>
            <button
              type="button"
              className="ocr-scope-btn"
              onClick={() => run(() => openHeaderFooter("bates"))}
            >
              <Fingerprint size={15} aria-hidden="true" />
              Bates numbering…
            </button>
            <div className="ocr-menu-divider" />
            <button type="button" className="ocr-scope-btn" onClick={() => run(openWatermark)}>
              <Droplets size={15} aria-hidden="true" />
              Watermark…
              {wmOn && <span className="stamp-on">On</span>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
