import { expect, test } from "vite-plus/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from "pdf-lib";
import { exportEditedPdf } from "./exportPdf";

function toFile(bytes: Uint8Array, name = "doc.pdf") {
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

/** Three pages with distinct widths (so order is observable), one text field
 * per page, a field with widgets on pages 1 AND 2, a bookmark tree, and a
 * named destination. */
async function buildDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [300, 400, 500].map((w) => doc.addPage([w, 600]));
  pages[1].drawText("SECRET-PAGE-TWO", { x: 20, y: 500, size: 12, font });
  const form = doc.getForm();
  pages.forEach((p, i) =>
    form.createTextField(`p${i}`).addToPage(p, { x: 20, y: 400, width: 150, height: 20 }),
  );
  const shared = form.createTextField("shared");
  shared.addToPage(pages[1], { x: 20, y: 300, width: 150, height: 20 });
  shared.addToPage(pages[2], { x: 20, y: 300, width: 150, height: 20 });

  // /Outlines with one item pointing at page 0, and /Names /Dests.
  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const itemRef = ctx.register(
    ctx.obj({
      Title: "Start",
      Parent: outlinesRef,
      Dest: [pages[0].ref, "Fit"],
    }),
  );
  ctx.assign(outlinesRef, ctx.obj({ Type: "Outlines", First: itemRef, Last: itemRef, Count: 1 }));
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  const dests = ctx.obj({ Names: ["intro", ctx.obj([pages[2].ref, "Fit"])] });
  doc.catalog.set(PDFName.of("Names"), ctx.obj({ Dests: ctx.register(dests) }));

  const bytes = await doc.save();
  // Refs of page 1's content streams, as they'll be numbered in `bytes`.
  const saved = await PDFDocument.load(bytes);
  const contents = saved.getPage(1).node.Contents();
  const page1ContentRefs = (contents instanceof PDFArray ? contents.asArray() : []).filter(
    (r): r is PDFRef => r instanceof PDFRef,
  );
  return { bytes, page1Ref: pages[1].ref, page1ContentRefs };
}

test("reorder + delete keeps a working, filled form and the catalog", async () => {
  const { bytes, page1Ref, page1ContentRefs } = await buildDoc();
  const out = await exportEditedPdf(toFile(bytes), [], {
    // Drop original page 1, put page 2 first.
    pageOrder: [2, 0],
    pageOps: [{ pageIndex: 2, rotation: 90 }],
    formValues: { p0: "zero", p2: "two", shared: "both" },
  });
  const doc = await PDFDocument.load(out);

  // Order + pageOps follow original indices (origToOut semantics unchanged).
  expect(doc.getPages().map((p) => p.getWidth())).toEqual([500, 300]);
  expect(doc.getPage(0).getRotation().angle).toBe(90);

  // The form survived, with the deleted page's own field gone and the shared
  // field keeping only its surviving widget.
  const form = doc.getForm();
  expect(
    form
      .getFields()
      .map((f) => f.getName())
      .sort(),
  ).toEqual(["p0", "p2", "shared"]);
  expect(form.getTextField("p0").getText()).toBe("zero");
  expect(form.getTextField("p2").getText()).toBe("two");
  const shared = form.getTextField("shared");
  expect(shared.getText()).toBe("both");
  expect(shared.acroField.getWidgets()).toHaveLength(1);

  // Every remaining widget sits on a page that exists (no dangling fields).
  const pageRefs = new Set(doc.getPages().map((p) => p.ref));
  for (const field of form.getFields()) {
    for (const w of field.acroField.getWidgets()) {
      const ref = doc.context.getObjectRef(w.dict);
      const onPage = doc.getPages().some((p) => p.node.Annots()?.asArray().includes(ref!));
      expect(onPage).toBe(true);
      expect(pageRefs.has(w.P()!)).toBe(true);
    }
  }

  // Bookmarks and named destinations are still in the catalog.
  expect(doc.catalog.lookup(PDFName.of("Outlines"), PDFDict).get(PDFName.of("First"))).toBeTruthy();
  const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
  expect(
    names.lookup(PDFName.of("Dests"), PDFDict).lookup(PDFName.of("Names"), PDFArray).size(),
  ).toBe(2);

  // The deleted page and its content are gone from the file, not just unlinked.
  expect(doc.context.lookup(page1Ref)).toBeUndefined();
  expect(page1ContentRefs.length).toBeGreaterThan(0);
  for (const ref of page1ContentRefs) expect(doc.context.lookup(ref)).toBeUndefined();
});

test("pure reorder (no deletion) keeps every field and its widgets", async () => {
  const { bytes } = await buildDoc();
  const out = await exportEditedPdf(toFile(bytes), [], { pageOrder: [1, 2, 0] });
  const doc = await PDFDocument.load(out);
  expect(doc.getPages().map((p) => p.getWidth())).toEqual([400, 500, 300]);
  expect(doc.getForm().getFields()).toHaveLength(4);
  expect(doc.getForm().getTextField("shared").acroField.getWidgets()).toHaveLength(2);
  expect(doc.catalog.get(PDFName.of("Outlines"))).toBeInstanceOf(PDFRef);
});

test("an untouched document keeps its outline object in the catalog", async () => {
  const { bytes } = await buildDoc();
  const src = await PDFDocument.load(bytes);
  const outlinesRef = src.catalog.get(PDFName.of("Outlines"));
  const out = await exportEditedPdf(toFile(bytes), [], { pageOrder: [0, 1, 2] });
  const doc = await PDFDocument.load(out);
  expect(doc.catalog.get(PDFName.of("Outlines"))).toBe(outlinesRef);
  expect(doc.getForm().getFields()).toHaveLength(4);
});

test("pages that inherited MediaBox/Resources from the tree keep them after a move", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  // Move page 1's MediaBox up to the page-tree root so it's inherited.
  const leaf = doc.getPage(1).node;
  const pagesRoot = doc.catalog.Pages();
  pagesRoot.set(PDFName.of("MediaBox"), doc.context.obj([0, 0, 612, 792]));
  leaf.delete(PDFName.of("MediaBox"));
  const bytes = await doc.save();

  const out = await exportEditedPdf(toFile(bytes), [], { pageOrder: [1, 0] });
  const outDoc = await PDFDocument.load(out);
  expect(outDoc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  expect(outDoc.getPage(1).getSize()).toEqual({ width: 200, height: 200 });
});
