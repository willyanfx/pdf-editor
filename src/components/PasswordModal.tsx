import { useState } from "react";
import { Lock } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * In-app unlock prompt for password-protected PDFs, replacing pdf.js's native
 * window.prompt(). Shown whenever an encrypted document needs a password (first
 * open) or rejects one (retry). Submitting stores the password and re-keys the
 * viewer's <Document> so the document reloads decrypted. There's no cancel: the
 * only ways out are a correct password or opening a different file — a half-open
 * encrypted document has nothing to show.
 */
export function PasswordModal() {
  const prompt = useEditorStore((s) => s.passwordPrompt);
  const submitPassword = useEditorStore((s) => s.submitPassword);
  const [password, setPassword] = useState("");
  // The prompt can't be dismissed without a password, so the focus trap's close
  // handler is a no-op (Escape shouldn't strand the user on a blank document).
  const trapRef = useFocusTrap<HTMLDivElement>(prompt != null, () => {});

  if (!prompt) return null;

  const submit = () => {
    if (!password) return;
    submitPassword(password);
    setPassword("");
  };

  return (
    <>
      <div className="palette-backdrop" />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Unlock PDF"
      >
        <div className="sig-header">
          <span>
            <Lock size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Password required
          </span>
        </div>
        <p className="split-hint">
          {prompt.wrong
            ? "That password was incorrect. Try again."
            : "This PDF is password-protected. Enter its password to open it."}
        </p>
        <input
          className="sig-type-input"
          type="password"
          aria-label="PDF password"
          aria-invalid={prompt.wrong}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoComplete="off"
          autoFocus
        />
        <div className="sig-actions">
          <button type="button" className="sig-insert" onClick={submit} disabled={!password}>
            Unlock
          </button>
        </div>
      </div>
    </>
  );
}
