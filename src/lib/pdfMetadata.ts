import { PDFDocument } from "pdf-lib";

/** Document properties read from a PDF, for the read-only metadata panel. */
export type PdfMetadata = {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: Date | null;
  modificationDate: Date | null;
  pageCount: number;
  /** Per-page size in PDF points (1pt = 1/72"), in current page order. */
  pageSizes: { width: number; height: number }[];
  /** Number of AcroForm fields, or 0 if the document has no form. */
  fieldCount: number;
  /** File size in bytes of the source file. */
  fileSize: number;
};

/** Trim a metadata string to null when empty/whitespace. */
function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Read document properties from a PDF File via pdf-lib. Encrypted PDFs are loaded
 * with `ignoreEncryption` so metadata is still readable. Date/field accessors can
 * throw on malformed PDFs, so each is guarded individually.
 */
export async function readPdfMetadata(file: File): Promise<PdfMetadata> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const safeDate = (fn: () => Date | undefined): Date | null => {
    try {
      return fn() ?? null;
    } catch {
      return null;
    }
  };

  let fieldCount = 0;
  try {
    fieldCount = doc.getForm().getFields().length;
  } catch {
    fieldCount = 0;
  }

  const pageSizes = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width: Math.round(width), height: Math.round(height) };
  });

  return {
    title: clean(doc.getTitle()),
    author: clean(doc.getAuthor()),
    subject: clean(doc.getSubject()),
    keywords: clean(doc.getKeywords()),
    creator: clean(doc.getCreator()),
    producer: clean(doc.getProducer()),
    creationDate: safeDate(() => doc.getCreationDate()),
    modificationDate: safeDate(() => doc.getModificationDate()),
    pageCount: doc.getPageCount(),
    pageSizes,
    fieldCount,
    fileSize: file.size,
  };
}

/** Human-readable file size (e.g. "1.4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Collapse page sizes to a short summary, e.g. "612 × 792 pt" or "mixed sizes". */
export function summarizePageSizes(sizes: { width: number; height: number }[]): string {
  if (!sizes.length) return "—";
  const first = `${sizes[0].width} × ${sizes[0].height} pt`;
  const allSame = sizes.every((s) => s.width === sizes[0].width && s.height === sizes[0].height);
  return allSame ? first : `${first} (mixed)`;
}
