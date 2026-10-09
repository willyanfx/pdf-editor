import type { PDFDocumentProxy } from "pdfjs-dist";

/** A file embedded in the PDF, either document-level (the catalog's EmbeddedFiles
 * tree) or attached to a page by a file-attachment annotation. */
export type AttachmentEntry = {
  id: string;
  filename: string;
  description: string;
  size: number;
  content: Uint8Array;
  /** 0-based page of a file-attachment annotation; null for document-level files. */
  pageIndex: number | null;
};

/** pdf.js's AnnotationType.FILEATTACHMENT. */
const FILE_ATTACHMENT_ANNOTATION = 17;

type RawFile = {
  filename?: string;
  rawFilename?: string;
  description?: string;
  content?: Uint8Array | null;
};

function toEntry(id: string, file: RawFile, pageIndex: number | null): AttachmentEntry | null {
  // pdf.js can't read non-embedded file specifications (content is null).
  if (!file.content) return null;
  return {
    id,
    filename: file.filename || file.rawFilename || "unnamed",
    description: file.description ?? "",
    size: file.content.byteLength,
    content: file.content,
    pageIndex,
  };
}

/** Everything embedded in the document: document-level files first, then page
 * attachments in page order. Never throws — an unreadable table just yields none. */
export async function loadAttachments(
  pdf: Pick<PDFDocumentProxy, "getAttachments" | "getAnnotationsByType">,
): Promise<AttachmentEntry[]> {
  const out: AttachmentEntry[] = [];

  try {
    const docLevel = ((await pdf.getAttachments()) ?? {}) as Record<string, RawFile>;
    Object.entries(docLevel).forEach(([key, file], i) => {
      const entry = toEntry(`doc-${i}`, { ...file, filename: file.filename || key }, null);
      if (entry) out.push(entry);
    });
  } catch {
    // fall through to page attachments
  }

  try {
    const annots = ((await pdf.getAnnotationsByType(
      new Set([FILE_ATTACHMENT_ANNOTATION]),
      new Set(),
    )) ?? []) as { pageIndex: number; file?: RawFile }[];
    annots
      .filter((a) => a.file)
      .sort((a, b) => a.pageIndex - b.pageIndex)
      .forEach((a, i) => {
        const entry = toEntry(`page-${a.pageIndex}-${i}`, a.file!, a.pageIndex);
        if (entry) out.push(entry);
      });
  } catch {
    // keep whatever the document-level pass found
  }

  return out;
}

/** A filename safe to hand to a download: no path parts, control or reserved
 * characters, and never empty or all dots. Attachments are untrusted. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return (cleaned || "attachment").slice(0, 200);
}

/** "512 B", "3.4 KB", "12 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${text} ${units[unit]}`;
}

/** Save an attachment to disk. Bytes are never opened or rendered here. */
export function downloadAttachment(entry: AttachmentEntry): void {
  const blob = new Blob([entry.content.slice()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(entry.filename);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
