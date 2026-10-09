import { Download, Paperclip } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useViewerStore } from "../store/useViewerStore";
import { downloadAttachment, formatBytes } from "../lib/attachments";

/**
 * Files embedded in the PDF: document-level attachments and files pinned to a
 * page by an annotation. Saving writes the raw bytes to disk — nothing is opened
 * or executed here.
 */
export function AttachmentsPanel() {
  const attachments = useViewerStore((s) => s.attachments);
  const scrollToPage = useEditorStore((s) => s.scrollToPage);

  return (
    <div className="att-panel">
      <ul className="att-list" aria-label="Attachments">
        {attachments.map((a) => (
          <li key={a.id} className="att-row">
            <Paperclip size={14} className="att-icon" aria-hidden="true" />
            <div className="att-info">
              <span className="att-name" title={a.filename}>
                {a.filename}
              </span>
              <span className="att-meta">
                {formatBytes(a.size)}
                {a.pageIndex !== null && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="att-page-link"
                      title="Go to the page this file is attached to"
                      onClick={() => scrollToPage?.(a.pageIndex as number)}
                    >
                      Page {a.pageIndex + 1}
                    </button>
                  </>
                )}
              </span>
              {a.description && <span className="att-desc">{a.description}</span>}
            </div>
            <button
              type="button"
              className="bm-icon-btn att-save"
              title={`Save ${a.filename}`}
              aria-label={`Save ${a.filename}`}
              onClick={() => downloadAttachment(a)}
            >
              <Download size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
