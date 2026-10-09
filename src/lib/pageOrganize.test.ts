import { test, expect, describe, beforeEach } from "vite-plus/test";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import { buildPlannedPdf, loadPdf } from "./pageOrganize";
import { planDuplicate, planInsert, planReplace } from "./pageRemap";
import { exportEditedPdf } from "./exportPdf";
import { useEditorStore, type PdfEdit } from "../store/useEditorStore";

/** A PDF whose pages carry a distinct width (positional fingerprint) and a
 * text label drawn into their content stream. */
async function makePdf(
  widths: number[],
  name = "doc.pdf",
  opts: { title?: string; indirectContents?: boolean } = {},
): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (opts.title) doc.setTitle(opts.title);
  widths.forEach((w, i) => {
    const page = doc.addPage([w, 792]);
    page.drawText(`Label ${name} ${i + 1}`, { x: 20, y: 700, size: 12, font });
    // An indirect /Contents array is the case where a shallow page copy would
    // share it — and an edit drawn on one page would show on the other.
    if (opts.indirectContents) {
      const contents = page.node.Contents();
      if (contents) page.node.set(PDFName.of("Contents"), doc.context.register(contents));
    }
  });
  return new File([(await doc.save()).slice()], name, { type: "application/pdf" });
}

async function widthsOf(bytes: Uint8Array | File): Promise<number[]> {
  const doc = await PDFDocument.load(bytes instanceof File ? await bytes.arrayBuffer() : bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

/** Decoded content-stream text of a page (all streams concatenated). */
function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const raw = page.node.get(PDFName.of("Contents"));
  const resolved = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
  // Contents is either one stream or an array of streams.
  const items = resolved instanceof PDFArray ? resolved.asArray() : [resolved];
  return items
    .map((r) => (r instanceof PDFRef ? ctx.lookup(r) : r))
    .map((s) =>
      s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "",
    )
    .join("\n");
}

describe("buildPlannedPdf", () => {
  test("duplicate yields N+k pages, each copy right after its original with the same content", async () => {
    const file = await makePdf([100, 101, 102]);
    const plan = planDuplicate(3, [0, 1, 2], [0, 2]);
    const bytes = await buildPlannedPdf(await loadPdf(file), plan.layout);
    expect(await widthsOf(bytes)).toEqual([100, 100, 101, 102, 102]);

    const out = await PDFDocument.load(bytes);
    const pages = out.getPages();
    expect(contentOf(pages[1])).toBe(contentOf(pages[0]));
    expect(contentOf(pages[4])).toBe(contentOf(pages[3]));
    expect(contentOf(pages[0])).not.toBe(contentOf(pages[3]));
  });

  test("a duplicated page is independent: an edit baked onto the copy leaves the original alone", async () => {
    const file = await makePdf([100, 101], "doc.pdf", { indirectContents: true });
    const plan = planDuplicate(2, [0, 1], [0]);
    const bytes = await buildPlannedPdf(await loadPdf(file), plan.layout);
    const dup = new File([bytes.slice()], "dup.pdf", { type: "application/pdf" });

    const box: PdfEdit = {
      id: "b",
      type: "rectangle",
      pageIndex: 1,
      x: 10,
      y: 10,
      width: 80,
      height: 40,
    };
    const plain = await PDFDocument.load(await exportEditedPdf(dup, []));
    const edited = await PDFDocument.load(await exportEditedPdf(dup, [box]));
    expect(contentOf(edited.getPage(0))).toBe(contentOf(plain.getPage(0)));
    expect(contentOf(edited.getPage(1))).not.toBe(contentOf(plain.getPage(1)));
  });

  test("replace swaps pages in place and preserves the surrounding order", async () => {
    const base = await makePdf([100, 101, 102, 103]);
    const other = await makePdf([200, 201, 202], "other.pdf");
    const plan = planReplace(4, [0, 1, 2, 3], [1, 2], [1, 2]);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([100, 201, 202, 103]);
  });

  test("replace with more pages than selected, and the same source page twice", async () => {
    const base = await makePdf([100, 101, 102]);
    const other = await makePdf([200, 201], "other.pdf");
    const plan = planReplace(3, [0, 1, 2], [1], [0, 1, 0]);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([100, 200, 201, 200, 102]);
  });

  test("replacing every page works", async () => {
    const base = await makePdf([100, 101]);
    const other = await makePdf([200], "other.pdf");
    const plan = planReplace(2, [0, 1], [0, 1], [0]);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([200]);
  });

  test("insert keeps document metadata (the base document is edited in place)", async () => {
    const base = await makePdf([100, 101], "base.pdf", { title: "Quarterly report" });
    const other = await makePdf([200], "other.pdf");
    const plan = planInsert(2, [0, 1], 1, 1);
    const bytes = await buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other));
    expect(await widthsOf(bytes)).toEqual([100, 200, 101]);
    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Quarterly report");
  });

  test("rejects source pages the other PDF doesn't have", async () => {
    const base = await makePdf([100]);
    const other = await makePdf([200], "other.pdf");
    const plan = planReplace(1, [0], [0], [3]);
    await expect(
      buildPlannedPdf(await loadPdf(base), plan.layout, await loadPdf(other)),
    ).rejects.toThrow(/doesn't have a page 4/);
  });
});

describe("store page operations", () => {
  const box = (id: string, pageIndex: number): PdfEdit => ({
    id,
    type: "rectangle",
    pageIndex,
    x: 1,
    y: 1,
    width: 2,
    height: 2,
  });

  beforeEach(async () => {
    const store = useEditorStore.getState();
    store.setFile(await makePdf([100, 101, 102]));
    store.setNumPages(3);
    useEditorStore.setState({ edits: [box("a", 0), box("c", 2)], _past: [], _future: [] });
  });

  test("duplicatePages rewrites the file, copies edits, and undoes in one step", async () => {
    const before = useEditorStore.getState();
    const created = await before.duplicatePages([2]);
    const after = useEditorStore.getState();

    expect(created).toEqual([3]);
    expect(after.numPages).toBe(4);
    expect(after.pageOrder).toEqual([0, 1, 2, 3]);
    expect(await widthsOf(after.file!)).toEqual([100, 101, 102, 102]);
    expect(after.edits.map((e) => e.pageIndex)).toEqual([0, 2, 3]);
    expect(new Set(after.edits.map((e) => e.id)).size).toBe(3);
    expect(after._past).toHaveLength(1);

    after.undo();
    const undone = useEditorStore.getState();
    expect(undone.file).toBe(before.file);
    expect(undone.pageOrder).toEqual([0, 1, 2]);
    expect(undone.edits).toEqual(before.edits);
  });

  test("replacePages keeps neighbours, drops the replaced page's edits", async () => {
    const other = await makePdf([200, 201], "other.pdf");
    const created = await useEditorStore.getState().replacePages([0], other, [1]);
    const after = useEditorStore.getState();
    expect(created).toEqual([0]);
    expect(await widthsOf(after.file!)).toEqual([201, 101, 102]);
    expect(after.edits.map((e) => e.id)).toEqual(["c"]);
    expect(after._past).toHaveLength(1);
  });

  test("insertPages after a deleted page keeps it deleted through the reload", async () => {
    useEditorStore.getState().deletePage(1);
    await useEditorStore.getState().insertPages([{ kind: "blank" }], 2);
    const s = useEditorStore.getState();
    expect(s.pageOrder).toEqual([0, 2, 3]);
    // The viewer re-reports the page count after the File changes.
    s.setNumPages(4);
    expect(useEditorStore.getState().pageOrder).toEqual([0, 2, 3]);
  });

  test("rotatePages and deletePages are one history step each", () => {
    const store = useEditorStore.getState();
    store.rotatePages([0, 2], 90);
    expect(useEditorStore.getState().pageOps).toEqual([
      { pageIndex: 0, rotation: 90 },
      { pageIndex: 2, rotation: 90 },
    ]);
    store.deletePages([0, 1]);
    const s = useEditorStore.getState();
    expect(s.pageOrder).toEqual([2]);
    expect(s.edits.map((e) => e.id)).toEqual(["c"]);
    expect(s._past).toHaveLength(2);
    // Never removes every page.
    s.deletePages([2]);
    expect(useEditorStore.getState().pageOrder).toEqual([2]);
  });
});
