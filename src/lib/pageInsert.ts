import { PDFDocument } from "pdf-lib";
import { convertToPdf } from "./convertToPdf";

/** US Letter, in PDF user units, for generated blank pages. */
const LETTER: [number, number] = [612, 792];
/** A4, in PDF user units. */
const A4: [number, number] = [595.28, 841.89];

/** A source of pages to insert into the open document. */
export type InsertSource =
  | { kind: "pdf"; file: File }
  /** Any convertToPdf-able file: image (one page), Word, Excel, CSV. */
  | { kind: "convert"; file: File }
  | { kind: "blank"; size?: "letter" | "a4"; count?: number };

/**
 * Turn one insert source into a standalone PDFDocument whose pages will be spliced
 * into the open document. Images/Office files route through convertToPdf so they
 * become real pages; blanks are generated; PDFs load directly.
 */
async function sourceToDoc(source: InsertSource): Promise<PDFDocument> {
  if (source.kind === "blank") {
    const doc = await PDFDocument.create();
    const dims = source.size === "a4" ? A4 : LETTER;
    const count = Math.max(1, Math.floor(source.count ?? 1));
    for (let i = 0; i < count; i++) doc.addPage(dims);
    return doc;
  }
  if (source.kind === "convert") {
    const bytes = await convertToPdf(source.file);
    return PDFDocument.load(bytes);
  }
  // kind === "pdf"
  const bytes = await source.file.arrayBuffer();
  return PDFDocument.load(bytes);
}

/**
 * Build a new PDF that splices the pages from `sources` into `baseFile` at the
 * given 0-based output position (0 = before the first page; baseCount = after the
 * last). Multiple sources are concatenated in order at that position.
 *
 * Returns the merged bytes plus `insertedCount` (how many pages were added), which
 * the caller needs to remap edit/page indices. The base document's pages keep
 * their relative order; only their absolute index shifts by `insertedCount` for
 * pages at or after `position`.
 */
export async function buildInsertedPdf(
  baseFile: File,
  sources: InsertSource[],
  position: number,
): Promise<{ bytes: Uint8Array; insertedCount: number }> {
  const baseBytes = await baseFile.arrayBuffer();
  const baseDoc = await PDFDocument.load(baseBytes);
  const baseCount = baseDoc.getPageCount();
  const at = Math.max(0, Math.min(position, baseCount));

  // Materialize all insert sources first so we know the total inserted count.
  const insertDocs = await Promise.all(sources.map(sourceToDoc));

  const out = await PDFDocument.create();

  // Copy base pages [0, at), then all inserted pages, then base pages [at, end).
  const head = await out.copyPages(
    baseDoc,
    Array.from({ length: at }, (_, i) => i),
  );
  for (const p of head) out.addPage(p);

  let insertedCount = 0;
  for (const doc of insertDocs) {
    const copied = await out.copyPages(doc, doc.getPageIndices());
    for (const p of copied) out.addPage(p);
    insertedCount += copied.length;
  }

  const tail = await out.copyPages(
    baseDoc,
    Array.from({ length: baseCount - at }, (_, i) => at + i),
  );
  for (const p of tail) out.addPage(p);

  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, insertedCount };
}

/**
 * Remap an original page index after `insertedCount` pages were inserted at output
 * position `at`. Existing pages at or after `at` shift right by `insertedCount`;
 * pages before `at` are unchanged. Used to rewrite edit.pageIndex, pageOps, and
 * pageOrder entries so they keep pointing at the same visual page.
 */
export function remapIndexAfterInsert(index: number, at: number, insertedCount: number): number {
  return index >= at ? index + insertedCount : index;
}

/**
 * The list of new page indices created by an insert at output position `at`.
 * (Contiguous: [at, at + insertedCount).) Useful for selecting/scrolling to the
 * first newly-added page after an insert.
 */
export function insertedIndices(at: number, insertedCount: number): number[] {
  return Array.from({ length: insertedCount }, (_, i) => at + i);
}
