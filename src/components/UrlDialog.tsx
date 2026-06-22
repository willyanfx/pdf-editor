import { useState } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * Open-from-URL dialog: fetches a PDF at the given URL and opens it. Stays open
 * (showing a spinner, then the error toast) if the fetch fails — typically a
 * CORS block, which the action's toast explains.
 */
export function UrlDialog() {
  const open = useEditorStore((s) => s.urlDialogOpen);
  const { openFromUrl } = useEditorActions();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const onClose = () => {
    useEditorStore.getState().setUrlDialogOpen(false);
    setUrl("");
    setBusy(false);
  };
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  const submit = () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    void openFromUrl(url)
      .then(() => onClose())
      .catch(() => setBusy(false)); // toast already shown; keep the dialog open
  };

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Open PDF from URL"
      >
        <div className="sig-header">
          <span>Open PDF from URL</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="split-hint">
          Paste a direct link to a PDF. The server must allow cross-origin requests; if it doesn't,
          download the file and open it instead.
        </p>
        <input
          className="sig-type-input"
          type="url"
          inputMode="url"
          aria-label="PDF URL"
          placeholder="https://example.com/file.pdf"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
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
            onClick={submit}
            disabled={!url.trim() || busy}
          >
            {busy ? "Opening…" : "Open"}
          </button>
        </div>
      </div>
    </>
  );
}
