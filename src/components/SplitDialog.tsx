import { useState } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * Split-by-range dialog. The spec is a comma-separated list of 1-based pages or
 * ranges (e.g. "1-3, 5, 8-10"); each group becomes its own downloaded PDF. An
 * empty spec falls back to one file per page (handled by the action).
 */
export function SplitDialog() {
  const open = useEditorStore((s) => s.splitDialogOpen);
  const numPages = useEditorStore((s) => s.numPages);
  const { splitPdf } = useEditorActions();
  const [spec, setSpec] = useState("");

  const onClose = () => useEditorStore.getState().setSplitDialogOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Split PDF"
      >
        <div className="sig-header">
          <span>Split PDF</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="split-hint">
          Document has {numPages} page{numPages === 1 ? "" : "s"}. Enter page ranges (e.g.{" "}
          <code>1-3, 5, 8-10</code>) — each becomes one file. Leave blank to split every page.
        </p>
        <input
          className="sig-type-input"
          aria-label="Page ranges to split"
          placeholder="e.g. 1-3, 5, 8-10"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sig-insert"
            onClick={() => {
              void splitPdf(spec);
              onClose();
            }}
          >
            Split
          </button>
        </div>
      </div>
    </>
  );
}
