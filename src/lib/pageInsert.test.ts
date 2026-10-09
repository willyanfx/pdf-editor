import { test, expect } from "vite-plus/test";
import { PDFDocument } from "pdf-lib";
import { buildInsertedPdf } from "./pageInsert";

/** Build a PDF whose pages each carry a distinct width so we can identify them
 * by position after a merge (page content text isn't easily read back). */
async function makeFileWithWidths(widths: number[], name: string): Promise<File> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 792]);
  const bytes = await doc.save();
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

/** Read back each page's width, our positional fingerprint. */
async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

// ---------------------------------------------------------------------------
// buildInsertedPdf — minimal integration test using pdf-lib to construct PDFs
// ---------------------------------------------------------------------------

test("buildInsertedPdf: inserts a blank page into a 2-page base, producing 3 pages", async () => {
  // Build a 2-page base PDF using pdf-lib (same library pageInsert uses internally).
  const { PDFDocument } = await import("pdf-lib");
  const base = await PDFDocument.create();
  base.addPage([612, 792]);
  base.addPage([612, 792]);
  const baseBytes = await base.save();
  const baseFile = new File([baseBytes.slice()], "base.pdf", { type: "application/pdf" });

  // Insert 1 blank page at position 1 (between the two existing pages).
  const sources = [{ kind: "blank" as const }];
  const { bytes, insertedCount } = await buildInsertedPdf(baseFile, sources, 1);

  expect(insertedCount).toBe(1);

  // Load the result and verify page count.
  const result = await PDFDocument.load(bytes);
  expect(result.getPageCount()).toBe(3);
});

test("buildInsertedPdf: inserts pages from another PDF at the right position (order check)", async () => {
  // Base pages fingerprinted by width 100, 101, 102; insert a 2-page PDF (200, 201)
  // at base index 1 → expect [100, 200, 201, 101, 102].
  const baseFile = await makeFileWithWidths([100, 101, 102], "base.pdf");
  const insFile = await makeFileWithWidths([200, 201], "ins.pdf");

  const { bytes, insertedCount } = await buildInsertedPdf(
    baseFile,
    [{ kind: "pdf", file: insFile }],
    1,
  );

  expect(insertedCount).toBe(2);
  expect(await widthsOf(bytes)).toEqual([100, 200, 201, 101, 102]);
});

test("buildInsertedPdf: appends when position is at the end", async () => {
  const baseFile = await makeFileWithWidths([100, 101], "base.pdf");
  const insFile = await makeFileWithWidths([200], "ins.pdf");

  // position === baseCount → after the last page.
  const { bytes } = await buildInsertedPdf(baseFile, [{ kind: "pdf", file: insFile }], 2);
  expect(await widthsOf(bytes)).toEqual([100, 101, 200]);
});

test("buildInsertedPdf: multiple sources concatenate in order at the slot", async () => {
  const baseFile = await makeFileWithWidths([100, 101], "base.pdf");
  const a = await makeFileWithWidths([200], "a.pdf");
  const b = await makeFileWithWidths([300, 301], "b.pdf");

  const { bytes, insertedCount } = await buildInsertedPdf(
    baseFile,
    [{ kind: "pdf", file: a }, { kind: "blank" }, { kind: "pdf", file: b }],
    1,
  );

  expect(insertedCount).toBe(4); // 1 + 1 blank + 2
  // a(200), blank(612 letter), b(300,301) spliced before original page index 1.
  expect(await widthsOf(bytes)).toEqual([100, 200, 612, 300, 301, 101]);
});

test("buildInsertedPdf: inserting 2 blank pages at position 0 prepends them", async () => {
  const base = await PDFDocument.create();
  base.addPage([612, 792]);
  base.addPage([612, 792]);
  const baseBytes = await base.save();
  const baseFile = new File([baseBytes.slice()], "base.pdf", { type: "application/pdf" });

  const sources = [{ kind: "blank" as const, count: 2 }];
  const { bytes, insertedCount } = await buildInsertedPdf(baseFile, sources, 0);

  expect(insertedCount).toBe(2);

  const result = await PDFDocument.load(bytes);
  expect(result.getPageCount()).toBe(4);
});
