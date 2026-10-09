import { PDFDocument, type PDFPage } from "pdf-lib";
import type { LayoutEntry } from "./pageRemap";

/** Load a File as an editable pdf-lib document. */
export async function loadPdf(file: File): Promise<PDFDocument> {
  return PDFDocument.load(await file.arrayBuffer());
}

/**
 * Rewrite `baseDoc` IN PLACE so its pages match `layout` (see lib/pageRemap.ts)
 * and return the saved bytes. Mutating the base document rather than copying
 * into a fresh one keeps document-level data — metadata, outline, form — that
 * a fresh document would drop.
 *
 * Clone entries are copied with their own copyPages call, so the copy shares no
 * mutable objects (content arrays, annotations) with its original: drawing
 * edits on one page at export can never bleed onto the other. Pages from
 * `extra` are copied in one batch so fonts/images they share are copied once.
 */
export async function buildPlannedPdf(
  baseDoc: PDFDocument,
  layout: LayoutEntry[],
  extra?: PDFDocument,
): Promise<Uint8Array> {
  const baseCount = baseDoc.getPageCount();
  const extraCount = extra?.getPageCount() ?? 0;

  // Surviving base pages must stay in ascending order: they are left where they
  // are and everything else is inserted around them.
  let last = -1;
  for (const e of layout) {
    if (e.kind === "base" && (e.index < 0 || e.index >= baseCount)) {
      throw new RangeError(`Page ${e.index + 1} is not in this document.`);
    }
    if (e.kind === "new" && (!extra || e.index < 0 || e.index >= extraCount)) {
      throw new RangeError(`The other PDF doesn't have a page ${e.index + 1}.`);
    }
    if (e.kind === "base" && !e.clone) {
      if (e.index <= last) throw new Error("Page layout must keep original pages in order.");
      last = e.index;
    }
  }

  // 1. Materialize every page that isn't already in baseDoc, before any removal
  //    shifts base indices.
  const added: (PDFPage | undefined)[] = Array.from({ length: layout.length });
  for (const [pos, e] of layout.entries()) {
    if (e.kind === "base" && e.clone) [added[pos]] = await baseDoc.copyPages(baseDoc, [e.index]);
  }
  if (extra) {
    // First use of each source page goes in one batch; a repeat gets its own
    // copy for the same independence reason as clones.
    const firstUse = new Map<number, number>();
    const repeats: number[] = [];
    layout.forEach((e, pos) => {
      if (e.kind !== "new") return;
      if (firstUse.has(e.index)) repeats.push(pos);
      else firstUse.set(e.index, pos);
    });
    const batch = await baseDoc.copyPages(extra, [...firstUse.keys()]);
    [...firstUse.values()].forEach((pos, i) => (added[pos] = batch[i]));
    for (const pos of repeats) {
      [added[pos]] = await baseDoc.copyPages(extra, [layout[pos].index]);
    }
  }

  // 2. Drop base pages the layout no longer contains (replaced), highest first.
  const kept = new Set(layout.flatMap((e) => (e.kind === "base" && !e.clone ? [e.index] : [])));
  for (let i = baseCount - 1; i >= 0; i--) if (!kept.has(i)) baseDoc.removePage(i);

  // 3. Kept pages are now in layout order; slot the new ones in around them.
  added.forEach((page, pos) => {
    if (page) baseDoc.insertPage(pos, page);
  });

  return baseDoc.save({ useObjectStreams: true });
}
