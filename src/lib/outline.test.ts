import { test, expect } from "vite-plus/test";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";
import { exportEditedPdf } from "./exportPdf";
import { readOutline, type OutlineSource } from "./outlineRead";
import { removeOutline, writeOutline } from "./outline";
import { makeBookmark, type Bookmark } from "./bookmarks";

// Pages get distinct widths so an output page can be traced back to its
// original index (width = 300 + 10 * originalIndex).
const widthOf = (orig: number) => 300 + 10 * orig;

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([widthOf(i), 500]);
  return doc.save();
}

function asFile(bytes: Uint8Array, name = "doc.pdf"): File {
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

/** Load bytes with the pdf.js legacy (Node) build, like the viewer would. */
async function openWithPdfJs(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  return task.promise;
}

/** The outline as plain data: titles, output page *widths* (→ original page),
 * tops, urls and nesting. */
type Shape = { title: string; page?: number | null; top?: number; url?: string; kids?: Shape[] };

async function outlineShape(bytes: Uint8Array): Promise<Shape[]> {
  const pdf = await openWithPdfJs(bytes);
  try {
    const tree = await readOutline(pdf as unknown as OutlineSource);
    const widths = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, i) => {
        const page = await pdf.getPage(i + 1);
        return Math.round(page.view[2] - page.view[0]);
      }),
    );
    const toShape = (b: Bookmark): Shape => {
      const s: Shape = { title: b.title };
      // Report the ORIGINAL page the output page came from (via its width).
      s.page = b.pageIndex === null ? null : (widths[b.pageIndex] - 300) / 10;
      if (b.top !== undefined) s.top = b.top;
      if (b.url) s.url = b.url;
      if (b.children.length) s.kids = b.children.map(toShape);
      return s;
    };
    return tree.map(toShape);
  } finally {
    await pdf.destroy();
  }
}

/** Raw /Outlines structure checks with pdf-lib: First/Last/Next/Prev/Parent/Count. */
function checkLinks(doc: PDFDocument): number {
  const rootRef = doc.catalog.get(PDFName.of("Outlines"));
  expect(rootRef).toBeInstanceOf(PDFRef);
  const root = doc.context.lookup(rootRef as PDFRef, PDFDict);
  expect(root.get(PDFName.of("Type"))).toBe(PDFName.of("Outlines"));

  /** Walk one sibling chain; returns the number of items (all open). */
  function walk(parentRef: PDFRef, parent: PDFDict): number {
    const first = parent.get(PDFName.of("First")) as PDFRef | undefined;
    const last = parent.get(PDFName.of("Last")) as PDFRef | undefined;
    if (!first) {
      expect(last).toBeUndefined();
      expect(parent.get(PDFName.of("Count"))).toBeUndefined();
      return 0;
    }
    let total = 0;
    let prev: PDFRef | undefined;
    let ref: PDFRef | undefined = first;
    while (ref) {
      const item = doc.context.lookup(ref, PDFDict);
      expect(item.get(PDFName.of("Parent"))).toBe(parentRef);
      expect(item.get(PDFName.of("Prev"))).toBe(prev);
      total += 1 + walk(ref, item);
      prev = ref;
      ref = item.get(PDFName.of("Next")) as PDFRef | undefined;
    }
    expect(prev).toBe(last);
    expect((parent.get(PDFName.of("Count")) as PDFNumber).asNumber()).toBe(total);
    return total;
  }
  return walk(rootRef as PDFRef, root);
}

const tree = (): Bookmark[] => [
  makeBookmark({
    title: "Chapter 1 — Über café",
    pageIndex: 0,
    top: 480,
    children: [
      makeBookmark({ title: "1.1 日本語の節", pageIndex: 1 }),
      makeBookmark({
        title: "1.2 Emoji 📘 section",
        pageIndex: 2,
        top: 120.5,
        children: [makeBookmark({ title: "Deep", pageIndex: 3 })],
      }),
    ],
  }),
  makeBookmark({ title: "Website", pageIndex: null, url: "https://example.com/a?b=1" }),
  makeBookmark({ title: "Appendix", pageIndex: 3 }),
];

test("round-trips nesting, unicode titles, tops and links through export", async () => {
  const file = asFile(await makePdf(4));
  const out = await exportEditedPdf(file, [], { bookmarks: tree() });

  expect(await outlineShape(out)).toEqual([
    {
      title: "Chapter 1 — Über café",
      page: 0,
      top: 480,
      kids: [
        { title: "1.1 日本語の節", page: 1 },
        { title: "1.2 Emoji 📘 section", page: 2, top: 120.5, kids: [{ title: "Deep", page: 3 }] },
      ],
    },
    { title: "Website", page: null, url: "https://example.com/a?b=1" },
    { title: "Appendix", page: 3 },
  ]);
  expect(checkLinks(await PDFDocument.load(out))).toBe(6);
});

test("bookmarks follow reordered pages to the right output page", async () => {
  const file = asFile(await makePdf(4));
  const out = await exportEditedPdf(file, [], {
    pageOrder: [3, 1, 0, 2],
    bookmarks: [
      makeBookmark({ title: "A", pageIndex: 0 }),
      makeBookmark({ title: "D", pageIndex: 3 }),
    ],
  });
  const doc = await PDFDocument.load(out);
  checkLinks(doc);
  // Shape reports the ORIGINAL page via width, so these must be unchanged…
  expect(await outlineShape(out)).toEqual([
    { title: "A", page: 0 },
    { title: "D", page: 3 },
  ]);
  // …while the raw dests point at output positions 2 and 0.
  const pdf = await openWithPdfJs(out);
  const outline = await pdf.getOutline();
  const positions = await Promise.all(
    outline.map((o) => pdf.getPageIndex((o.dest as [{ num: number; gen: number }])[0])),
  );
  expect(positions).toEqual([2, 0]);
  await pdf.destroy();
});

test("bookmarks on deleted pages are dropped and their children promoted", async () => {
  const file = asFile(await makePdf(4));
  const out = await exportEditedPdf(file, [], {
    pageOrder: [0, 2, 3], // page 1 deleted
    bookmarks: [
      makeBookmark({ title: "Intro", pageIndex: 0 }),
      makeBookmark({
        title: "Gone",
        pageIndex: 1,
        children: [
          makeBookmark({ title: "Kept 1", pageIndex: 2 }),
          makeBookmark({
            title: "Gone too",
            pageIndex: 1,
            children: [makeBookmark({ title: "Kept 2", pageIndex: 3 })],
          }),
        ],
      }),
      makeBookmark({ title: "End", pageIndex: 3 }),
    ],
  });
  expect(await outlineShape(out)).toEqual([
    { title: "Intro", page: 0 },
    { title: "Kept 1", page: 2 },
    { title: "Kept 2", page: 3 },
    { title: "End", page: 3 },
  ]);
  expect(checkLinks(await PDFDocument.load(out))).toBe(4);
});

test("replaces a stale outline, and removes it when no bookmarks remain", async () => {
  // A source file that already has an outline.
  const src = await PDFDocument.load(await makePdf(3));
  writeOutline(src, [makeBookmark({ title: "Old", pageIndex: 1 })], [0, 1, 2]);
  const file = asFile(await src.save());
  expect(await outlineShape(await src.save())).toEqual([{ title: "Old", page: 1 }]);

  // bookmarks omitted → outline untouched (in-place export path).
  expect(await outlineShape(await exportEditedPdf(file, []))).toEqual([{ title: "Old", page: 1 }]);

  // New bookmarks replace it entirely.
  const replaced = await exportEditedPdf(file, [], {
    bookmarks: [makeBookmark({ title: "New", pageIndex: 2 })],
  });
  expect(await outlineShape(replaced)).toEqual([{ title: "New", page: 2 }]);
  const replacedDoc = await PDFDocument.load(replaced);
  expect(checkLinks(replacedDoc)).toBe(1);

  // Empty bookmarks → no /Outlines at all.
  const cleared = await exportEditedPdf(file, [], { bookmarks: [] });
  const clearedDoc = await PDFDocument.load(cleared);
  expect(clearedDoc.catalog.get(PDFName.of("Outlines"))).toBeUndefined();
  expect(await outlineShape(cleared)).toEqual([]);
});

test("removeOutline deletes the old item objects instead of leaving orphans", async () => {
  const doc = await PDFDocument.load(await makePdf(2));
  const before = doc.context.enumerateIndirectObjects().length;
  writeOutline(
    doc,
    [
      makeBookmark({
        title: "A",
        pageIndex: 0,
        children: [makeBookmark({ title: "B", pageIndex: 1 })],
      }),
    ],
    [0, 1],
  );
  expect(doc.context.enumerateIndirectObjects().length).toBe(before + 3); // root + 2 items
  removeOutline(doc);
  expect(doc.context.enumerateIndirectObjects().length).toBe(before);
  expect(doc.catalog.get(PDFName.of("Outlines"))).toBeUndefined();
});

test("does not add an outline when every bookmark's page was deleted", async () => {
  const file = asFile(await makePdf(3));
  const out = await exportEditedPdf(file, [], {
    pageOrder: [0, 2],
    bookmarks: [makeBookmark({ title: "Only", pageIndex: 1 })],
  });
  expect((await PDFDocument.load(out)).catalog.get(PDFName.of("Outlines"))).toBeUndefined();
});

test("readOutline resolves named destinations and keeps unsupported entries title-only", async () => {
  const doc = await PDFDocument.load(await makePdf(3));
  const { context } = doc;
  const pages = doc.getPages();
  // Named destination "sec2" → page 2, /XYZ top 300.
  const names = context.obj({
    Names: [PDFString.of("sec2"), context.obj([pages[2].ref, PDFName.of("XYZ"), 0, 300, 0])],
  });
  doc.catalog.set(PDFName.of("Names"), context.obj({ Dests: context.register(names) }));

  const rootRef = context.nextRef();
  const aRef = context.nextRef();
  const bRef = context.nextRef();
  const a = context.obj({ Title: PDFString.of("Named"), Parent: rootRef, Next: bRef });
  a.set(PDFName.of("Dest"), PDFString.of("sec2"));
  context.assign(aRef, a);
  // A JavaScript action: no page to go to.
  const b = context.obj({ Title: PDFString.of("Script"), Parent: rootRef, Prev: aRef });
  b.set(PDFName.of("A"), context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
  context.assign(bRef, b);
  context.assign(rootRef, context.obj({ Type: "Outlines", First: aRef, Last: bRef, Count: 2 }));
  doc.catalog.set(PDFName.of("Outlines"), rootRef);

  const pdf = await openWithPdfJs(await doc.save());
  const read = await readOutline(pdf as unknown as OutlineSource);
  await pdf.destroy();
  expect(read.map((b) => ({ title: b.title, pageIndex: b.pageIndex, top: b.top }))).toEqual([
    { title: "Named", pageIndex: 2, top: 300 },
    { title: "Script", pageIndex: null, top: undefined },
  ]);
});
