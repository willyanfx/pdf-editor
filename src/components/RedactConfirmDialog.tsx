import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * Shown once per document, before the first download/split/merge while
 * redaction marks are pending. Explains what the output will contain; the
 * download continues only on an explicit "Apply".
 */
export function RedactConfirmDialog() {
  const pending = useEditorStore((s) => s.redactConfirm);
  const cancel = () => pending?.resolve(false);
  const trapRef = useFocusTrap<HTMLDivElement>(pending !== null, cancel);

  if (!pending) return null;
  const n = pending.count;

  return (
    <>
      <div className="palette-backdrop" onClick={cancel} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="redact-confirm-title"
        aria-describedby="redact-confirm-desc"
      >
        <div className="sig-header">
          <span id="redact-confirm-title">
            Apply {n} redaction{n === 1 ? "" : "s"}?
          </span>
          <button type="button" className="sig-close" onClick={cancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div id="redact-confirm-desc" className="split-hint redact-confirm-body">
          <p>
            In the file you download, everything under a redaction mark is permanently removed:
            text, pictures, drawings, comments and form fields. The marked areas become solid black.
          </p>
          <p>
            Pages that carry marks are saved as a picture of the page. Their remaining text can
            still be searched, but it can no longer be edited as text. Pages without marks are not
            changed.
          </p>
          <p>Your original file and your work here stay exactly as they are.</p>
        </div>
        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="sig-insert" onClick={() => pending.resolve(true)}>
            Apply redactions
          </button>
        </div>
      </div>
    </>
  );
}
