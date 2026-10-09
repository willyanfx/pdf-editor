import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isPdfEncrypted } from "../lib/pdfMetadata";
import {
  ALL_PERMISSIONS,
  validateProtectOptions,
  type PdfPermissions,
  type PrintPermission,
} from "../lib/pdfSecurity";

type Mode = "protect" | "remove";
type State = "idle" | "exporting" | "done";

const PERMISSION_TOGGLES: { key: Exclude<keyof PdfPermissions, "print">; label: string }[] = [
  { key: "copy", label: "Copying text and images" },
  { key: "edit", label: "Editing page content" },
  { key: "annotate", label: "Commenting and filling forms" },
  { key: "assemble", label: "Inserting, deleting and rotating pages" },
];

/**
 * Add a password and/or permission restrictions to the exported PDF, or strip
 * the protection from an encrypted one. Both produce a download; encryption is
 * AES-256 applied by qpdf after the edits are baked in (see lib/pdfSecurity).
 */
export function ProtectDialog() {
  const open = useEditorStore((s) => s.protectDialogOpen);
  const file = useEditorStore((s) => s.file);
  const { protectPdf } = useEditorActions();

  const [mode, setMode] = useState<Mode>("protect");
  const [encrypted, setEncrypted] = useState(false);
  const [userPassword, setUserPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [permissions, setPermissions] = useState<PdfPermissions>(ALL_PERMISSIONS);
  const [state, setState] = useState<State>("idle");

  const onClose = () => useEditorStore.getState().setProtectDialogOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  // Start each session from a clean slate — passwords shouldn't linger in
  // component state between openings — and learn whether the source is
  // encrypted so "remove protection" is only offered when it applies.
  useEffect(() => {
    if (!open || !file) return;
    setMode("protect");
    setUserPassword("");
    setOwnerPassword("");
    setShowPasswords(false);
    setPermissions(ALL_PERMISSIONS);
    setState("idle");
    setEncrypted(false);
    let cancelled = false;
    void isPdfEncrypted(file).then((yes) => {
      if (!cancelled) setEncrypted(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  if (!open) return null;

  const options = { userPassword, ownerPassword, permissions };
  const problem = validateProtectOptions(options);
  const exporting = state === "exporting";
  const canSubmit = !exporting && (mode === "remove" || problem === null);

  const submit = () => {
    if (!canSubmit) return;
    void protectPdf(
      {
        onStart: () => setState("exporting"),
        onSuccess: () => {
          setState("done");
          onClose();
        },
        onError: () => setState("idle"),
      },
      mode === "protect" ? options : null,
    );
  };

  const passwordType = showPasswords ? "text" : "password";

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Protect PDF"
      >
        <div className="sig-header">
          <span>Protect PDF</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="sig-tabs" role="tablist" aria-label="Protection">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "protect"}
            className={mode === "protect" ? "active" : ""}
            onClick={() => setMode("protect")}
            disabled={exporting}
          >
            Add protection
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "remove"}
            className={mode === "remove" ? "active" : ""}
            onClick={() => setMode("remove")}
            disabled={exporting || !encrypted}
            title={encrypted ? undefined : "This PDF isn't password-protected"}
          >
            Remove protection
          </button>
        </div>

        {mode === "remove" ? (
          <p className="split-hint">
            Downloads a copy of this PDF with its password and permission restrictions removed.
          </p>
        ) : (
          <form
            className="protect-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="protect-field">
              <span>Password to open</span>
              <input
                className="sig-type-input"
                type={passwordType}
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                placeholder="Optional — leave empty to let anyone open it"
                autoComplete="new-password"
                disabled={exporting}
                autoFocus
              />
            </label>
            <label className="protect-field">
              <span>Permissions password</span>
              <input
                className="sig-type-input"
                type={passwordType}
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Needed to change the restrictions below"
                autoComplete="new-password"
                disabled={exporting}
              />
            </label>
            <label className="protect-check">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
              />
              Show passwords
            </label>

            <fieldset className="protect-perms" disabled={exporting}>
              <legend>Allow</legend>
              <label className="protect-field protect-inline">
                <span>Printing</span>
                <select
                  value={permissions.print}
                  onChange={(e) =>
                    setPermissions((p) => ({ ...p, print: e.target.value as PrintPermission }))
                  }
                >
                  <option value="full">High resolution</option>
                  <option value="low">Low resolution</option>
                  <option value="none">Not allowed</option>
                </select>
              </label>
              {PERMISSION_TOGGLES.map(({ key, label }) => (
                <label key={key} className="protect-check">
                  <input
                    type="checkbox"
                    checked={permissions[key]}
                    onChange={(e) => setPermissions((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            <p className="split-hint protect-note" role={problem ? "status" : undefined}>
              {problem ??
                "Encrypted with AES-256. Restrictions are honored by well-behaved PDF readers; only the password to open actually keeps the contents private. Forgotten passwords can't be recovered."}
            </p>
          </form>
        )}

        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sig-insert" onClick={submit} disabled={!canSubmit}>
            {exporting
              ? "Working…"
              : mode === "protect"
                ? "Protect & Download"
                : "Remove & Download"}
          </button>
        </div>
      </div>
    </>
  );
}
