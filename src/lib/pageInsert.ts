import { PDFDocument } from "pdf-lib";
import { convertToPdf } from "./convertToPdf";
import { buildPlannedPdf, loadPdf } from "./pageOrganize";
import { planInsert } from "./pageRemap";

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
 * Concatenate every insert source into one document, in order: the "extra"
 * document whose pages a page-insert plan (lib/pageRemap.ts planInsert) splices in.
 */
export async function sourcesToDoc(sources: InsertSource[]): Promise<PDFDocument> {
  const docs = await Promise.all(sources.map(sourceToDoc));
  if (docs.length === 1) return docs[0];
  const out = await PDFDocument.create();
  for (const doc of docs) {
    const copied = await out.copyPages(doc, doc.getPageIndices());
    for (const p of copied) out.addPage(p);
  }
  return out;
}

/**
 * Build a new PDF that splices the pages from `sources` into `baseFile` at the
 * given 0-based output position (0 = before the first page; baseCount = after the
 * last). Multiple sources are concatenated in order at that position.
 *
 * Returns the merged bytes plus `insertedCount` (how many pages were added). The
 * base document's pages keep their relative order; only their absolute index
 * shifts by `insertedCount` for pages at or after `position`.
 */
export async function buildInsertedPdf(
  baseFile: File,
  sources: InsertSource[],
  position: number,
): Promise<{ bytes: Uint8Array; insertedCount: number }> {
  const [baseDoc, extra] = await Promise.all([loadPdf(baseFile), sourcesToDoc(sources)]);
  const baseCount = baseDoc.getPageCount();
  const insertedCount = extra.getPageCount();
  const identity = baseDoc.getPageIndices();
  const { layout } = planInsert(baseCount, identity, Math.max(0, position), insertedCount);
  const bytes = await buildPlannedPdf(baseDoc, layout, extra);
  return { bytes, insertedCount };
}
