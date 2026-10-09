import { RotateCcw } from "lucide-react";
import {
  useRecoveryStore,
  recoverPending,
  discardPending,
  formatRelativeTime,
} from "../lib/autosave";
import { isDocumentDirty } from "../store/useEditorStore";

/** Non-blocking offer to restore last session's unsaved changes. */
export function RecoveryBanner() {
  const info = useRecoveryStore((s) => s.info);
  if (!info) return null;

  function onRecover() {
    // Recovering replaces whatever is open now.
    if (
      isDocumentDirty() &&
      !window.confirm("Replace the open document? Its unsaved changes will be lost.")
    ) {
      return;
    }
    recoverPending();
  }

  return (
    <div className="recovery-banner" role="region" aria-label="Recover unsaved changes">
      <RotateCcw size={16} className="recovery-icon" aria-hidden="true" />
      <span className="recovery-text">
        Recover unsaved changes to <strong>{info.fileName}</strong> from{" "}
        {formatRelativeTime(info.savedAt)}?
      </span>
      <button type="button" className="sig-insert recovery-btn" onClick={onRecover}>
        Recover
      </button>
      <button
        type="button"
        className="sig-cancel recovery-btn"
        onClick={() => void discardPending()}
      >
        Discard
      </button>
    </div>
  );
}
