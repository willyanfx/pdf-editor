import { PDFDocument } from "pdf-lib";

/**
 * Combine several PDFs into one, preserving order. All pages of each input are
 * copied into a fresh document via pdf-lib's copyPages (the same API exportPdf
 * uses for reordering). Returns the merged PDF bytes.
 */
export async function mergePdfs(files: File[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return out.save({ useObjectStreams: true });
}

/** One output file from a split: a label (for the download name) + its bytes. */
export type SplitPart = { label: string; bytes: Uint8Array };

/**
 * Parse a 1-based page-range spec like "1-3, 5, 8-10" into arrays of 0-based
 * page indices (one array per comma-separated group). Out-of-range and malformed
 * tokens are ignored. Returns one group per non-empty token.
 */
export function parsePageRanges(spec: string, pageCount: number): number[][] {
  const groups: number[][] = [];
  for (const tokenRaw of spec.split(",")) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    const single = token.match(/^(\d+)$/);
    const indices: number[] = [];
    if (range) {
      let a = Number.parseInt(range[1], 10);
      let b = Number.parseInt(range[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) {
        if (p >= 1 && p <= pageCount) indices.push(p - 1);
      }
    } else if (single) {
      const p = Number.parseInt(single[1], 10);
      if (p >= 1 && p <= pageCount) indices.push(p - 1);
    }
    if (indices.length) groups.push(indices);
  }
  return groups;
}

/**
 * Split a PDF into one output document per page-range group. With no spec, emits
 * one file per page. Returns the parts ready to download.
 */
export async function splitPdf(file: File, spec: string): Promise<SplitPart[]> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();

  const groups =
    spec.trim().length > 0
      ? parsePageRanges(spec, pageCount)
      : Array.from({ length: pageCount }, (_, i) => [i]);

  const parts: SplitPart[] = [];
  for (let g = 0; g < groups.length; g++) {
    const indices = groups[g];
    if (!indices.length) continue;
    const out = await PDFDocument.create();
    const copied = await out.copyPages(doc, indices);
    for (const p of copied) out.addPage(p);
    const label =
      indices.length === 1
        ? `p${indices[0] + 1}`
        : `p${indices[0] + 1}-${indices[indices.length - 1] + 1}`;
    parts.push({ label, bytes: await out.save({ useObjectStreams: true }) });
  }
  return parts;
}
