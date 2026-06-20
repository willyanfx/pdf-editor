import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import {
  readPdfMetadata,
  formatBytes,
  summarizePageSizes,
  type PdfMetadata,
} from "../lib/pdfMetadata";
import { useFocusTrap } from "../hooks/useFocusTrap";

/** Format a date for display, or "—" when absent. */
function fmtDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

/**
 * Read-only document-properties panel: title/author/dates/page count/sizes and
 * AcroForm field count, read from the open PDF via pdf-lib when the modal opens.
 */
export function MetadataModal() {
  const open = useEditorStore((s) => s.metadataModalOpen);
  const file = useEditorStore((s) => s.file);
  const close = () => useEditorStore.getState().setMetadataModalOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, close);

  const [meta, setMeta] = useState<PdfMetadata | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    setMeta(null);
    setError(false);
    void readPdfMetadata(file)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  if (!open) return null;

  const rows: [string, string][] = meta
    ? [
        ["Title", meta.title ?? "—"],
        ["Author", meta.author ?? "—"],
        ["Subject", meta.subject ?? "—"],
        ["Keywords", meta.keywords ?? "—"],
        ["Creator", meta.creator ?? "—"],
        ["Producer", meta.producer ?? "—"],
        ["Created", fmtDate(meta.creationDate)],
        ["Modified", fmtDate(meta.modificationDate)],
        ["Pages", String(meta.pageCount)],
        ["Page size", summarizePageSizes(meta.pageSizes)],
        ["Form fields", meta.fieldCount ? String(meta.fieldCount) : "None"],
        ["File", `${file?.name ?? ""} (${formatBytes(meta.fileSize)})`],
      ]
    : [];

  return (
    <>
      <div className="palette-backdrop" onClick={close} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Document properties"
      >
        <div className="sig-header">
          <span>Document properties</span>
          <button type="button" className="sig-close" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {error && <p className="split-hint">Could not read this PDF's properties.</p>}
        {!error && !meta && <p className="split-hint">Reading properties…</p>}
        {meta && (
          <dl className="meta-list">
            {rows.map(([label, value]) => (
              <div key={label} className="meta-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}
