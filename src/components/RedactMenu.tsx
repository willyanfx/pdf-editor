import { useState } from "react";
import { EyeOff, SearchCheck, SquareDashed, Trash2, X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { RailButton } from "./RailButton";

/**
 * Redaction entry point in the tool rail: a popover with the marking tool, the
 * search dialog, the solid-black preview toggle and the pending-mark count.
 * Mirrors OcrMenu's popover pattern (same classes, focus trap, backdrop).
 */
export function RedactMenu() {
  const [open, setOpen] = useState(false);
  const file = useEditorStore((s) => s.file);
  const mode = useEditorStore((s) => s.mode);
  const previewSolid = useEditorStore((s) => s.redactPreviewSolid);
  const setPreviewSolid = useEditorStore((s) => s.setRedactPreviewSolid);
  const pending = useEditorStore((s) =>
    s.edits.reduce((n, e) => n + (e.type === "redact" ? 1 : 0), 0),
  );
  const { setMode, openRedactSearch, clearRedactions } = useEditorActions();

  const close = () => setOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, close);

  return (
    <div className="ocr-menu-anchor">
      <RailButton
        icon={<EyeOff size={18} />}
        tip="Redact (R)"
        active={open || mode === "redact"}
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
            className="ocr-menu-popover redact-menu"
            role="dialog"
            aria-modal="false"
            aria-label="Redaction options"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sig-header">
              <span>
                <EyeOff size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Redact
              </span>
              <button
                type="button"
                className="sig-close"
                onClick={close}
                aria-label="Close redaction menu"
              >
                <X size={16} />
              </button>
            </div>

            <span className="ocr-menu-label">Mark</span>
            <button
              type="button"
              className="ocr-scope-btn"
              onClick={() => {
                setMode("redact");
                close();
              }}
            >
              <SquareDashed size={15} aria-hidden="true" />
              Mark text or an area…
              <kbd className="redact-kbd">R</kbd>
            </button>
            <button
              type="button"
              className="ocr-scope-btn"
              onClick={() => {
                openRedactSearch();
                close();
              }}
            >
              <SearchCheck size={15} aria-hidden="true" />
              Search &amp; redact…
            </button>

            <div className="ocr-menu-divider" />

            <span className="ocr-menu-label">Preview</span>
            <label className="redact-check">
              <input
                type="checkbox"
                checked={previewSolid}
                onChange={(e) => setPreviewSolid(e.target.checked)}
              />
              Show marks as solid black
            </label>

            <div className="ocr-menu-divider" />

            <p className="ocr-menu-hint redact-status" aria-live="polite">
              {pending === 0
                ? "No marks yet. Marked content is permanently removed from the file when you download."
                : `${pending} mark${pending === 1 ? "" : "s"} pending. The content under ${pending === 1 ? "it" : "them"} is permanently removed when you download.`}
            </p>
            {pending > 0 && (
              <button
                type="button"
                className="ocr-scope-btn"
                onClick={() => {
                  clearRedactions();
                  close();
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
                Remove all marks
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
