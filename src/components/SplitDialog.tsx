import { useState } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";

type SplitMode = "ranges" | "interval";

/**
 * Split dialog with two modes. "ranges": a comma-separated list of 1-based pages
 * or ranges (e.g. "1-3, 5, 8-10"), each group becoming its own PDF; empty falls
 * back to one file per page. "interval": one file per N consecutive pages.
 */
export function SplitDialog() {
  const open = useEditorStore((s) => s.splitDialogOpen);
  const numPages = useEditorStore((s) => s.numPages);
  const { splitPdf } = useEditorActions();
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [spec, setSpec] = useState("");
  const [chunkSize, setChunkSize] = useState(1);

  const onClose = () => useEditorStore.getState().setSplitDialogOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  const submit = () => {
    if (mode === "interval") {
      void splitPdf({ mode: "interval", chunkSize: Math.max(1, chunkSize) });
    } else {
      void splitPdf({ mode: "ranges", spec });
    }
    onClose();
  };

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
          Document has {numPages} page{numPages === 1 ? "" : "s"}.
        </p>
        <div className="sig-tabs" role="tablist" aria-label="Split method">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "ranges"}
            className={mode === "ranges" ? "active" : ""}
            onClick={() => setMode("ranges")}
          >
            By ranges
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "interval"}
            className={mode === "interval" ? "active" : ""}
            onClick={() => setMode("interval")}
          >
            Every N pages
          </button>
        </div>

        {mode === "ranges" ? (
          <div role="tabpanel" aria-label="Split by ranges">
            <p className="split-hint">
              Enter page ranges (e.g. <code>1-3, 5, 8-10</code>) — each becomes one file. Leave
              blank to split every page.
            </p>
            <input
              className="sig-type-input"
              aria-label="Page ranges to split"
              placeholder="e.g. 1-3, 5, 8-10"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        ) : (
          <div role="tabpanel" aria-label="Split every N pages">
            <p className="split-hint">
              Split into chunks of{" "}
              <input
                type="number"
                className="split-chunk-input"
                aria-label="Pages per file"
                min={1}
                max={Math.max(1, numPages)}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number.parseInt(e.target.value, 10) || 1)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoFocus
              />{" "}
              page{chunkSize === 1 ? "" : "s"} each ={" "}
              {Math.ceil(numPages / Math.max(1, chunkSize)) || 0} file
              {Math.ceil(numPages / Math.max(1, chunkSize)) === 1 ? "" : "s"}.
            </p>
          </div>
        )}

        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sig-insert" onClick={submit}>
            Split
          </button>
        </div>
      </div>
    </>
  );
}
