import { expect, test } from "vite-plus/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  PDFString,
  type PDFContext,
} from "pdf-lib";
import {
  describeRemoved,
  hasHiddenInfo,
  sanitizePdf,
  scanHiddenInfo,
  DEFAULT_SANITIZE,
} from "./sanitize";

/** A document carrying one of everything the sanitizer knows about. */
async function dirtyDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setAuthor("Secret Author");
  doc.setTitle("Draft");
  const page = doc.addPage();
  const ctx = doc.context;

  // XMP metadata stream on the catalog.
  const xmp = ctx.register(
    ctx.stream("<x:xmpmeta>secret</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" }),
  );
  doc.catalog.set(PDFName.of("Metadata"), xmp);

  // Embedded file.
  await doc.attach(new TextEncoder().encode("confidential attachment"), "notes.txt", {
    mimeType: "text/plain",
  });

  // A comment, a link with a JavaScript action, and a plain link.
  const note = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [10, 10, 30, 30],
      Contents: PDFString.of("hi"),
    }),
  );
  const jsLink = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 40, 60, 60],
      A: { S: "JavaScript", JS: PDFString.of("app.alert(1)") },
    }),
  );
  const urlLink = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 70, 60, 90],
      A: { S: "URI", URI: PDFString.of("https://example.com") },
    }),
  );
  page.node.set(PDFName.of("Annots"), ctx.obj([note, jsLink, urlLink]));

  // Open-action script and a document-level script.
  doc.catalog.set(
    PDFName.of("OpenAction"),
    ctx.obj({ S: "JavaScript", JS: PDFString.of("run()") }),
  );

  // Two bookmarks.
  const outlines = ctx.nextRef();
  const a = ctx.nextRef();
  const b = ctx.nextRef();
  ctx.assign(outlines, ctx.obj({ Type: "Outlines", First: a, Last: b, Count: 2 }));
  ctx.assign(a, ctx.obj({ Title: PDFString.of("A"), Parent: outlines, Next: b }));
  ctx.assign(b, ctx.obj({ Title: PDFString.of("B"), Parent: outlines, Prev: a }));
  doc.catalog.set(PDFName.of("Outlines"), outlines);

  // App-private data and a thumbnail on the page.
  page.node.set(PDFName.of("PieceInfo"), ctx.obj({ App: { Private: PDFString.of("x") } }));
  return doc.save();
}

/** Every dict/stream-dict in the document, for "is this key anywhere?" checks. */
function allDicts(ctx: PDFContext): PDFDict[] {
  const out: PDFDict[] = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) out.push(obj);
    else if (obj instanceof PDFStream) out.push(obj.dict);
  }
  return out;
}

test("scanHiddenInfo reports what the document contains", async () => {
  const report = await scanHiddenInfo(await dirtyDoc());
  expect(report).toMatchObject({
    comments: 1,
    attachments: 1,
    javascript: 2, // the link action + the open action
    bookmarks: 2,
    hiddenLayers: 0,
  });
  expect(report.metadata).toBeGreaterThan(0);
  expect(hasHiddenInfo(report)).toBe(true);
});

test("a clean document reports nothing", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.setProducer("");
  const report = await scanHiddenInfo(await doc.save());
  expect(report).toMatchObject({ comments: 0, attachments: 0, javascript: 0, bookmarks: 0 });
});

test("sanitizePdf removes every category and leaves no object behind", async () => {
  const { bytes, removed } = await sanitizePdf(await dirtyDoc(), DEFAULT_SANITIZE);
  expect(removed).toMatchObject({ comments: 1, attachments: 1, javascript: 2, bookmarks: 2 });

  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(out.getAuthor()).toBeUndefined();
  expect(out.getTitle()).toBeUndefined();
  expect(out.catalog.has(PDFName.of("Metadata"))).toBe(false);
  expect(out.catalog.has(PDFName.of("Outlines"))).toBe(false);
  expect(out.catalog.has(PDFName.of("OpenAction"))).toBe(false);

  // The attachment's bytes are gone from the file, not just unlinked.
  const dicts = allDicts(out.context);
  expect(dicts.some((d) => d.get(PDFName.of("Type"))?.toString() === "/EmbeddedFile")).toBe(false);
  expect(dicts.some((d) => d.has(PDFName.of("PieceInfo")))).toBe(false);

  // The text note went; the plain web link stayed and lost nothing.
  const annots = out.getPage(0).node.Annots() as PDFArray;
  expect(annots.size()).toBe(2);
  const subtypes = [0, 1].map((i) =>
    (out.context.lookup(annots.get(i)) as PDFDict).get(PDFName.of("Subtype"))?.toString(),
  );
  expect(subtypes).toEqual(["/Link", "/Link"]);
  const actions = [0, 1].map((i) =>
    (out.context.lookup(annots.get(i)) as PDFDict).has(PDFName.of("A")),
  );
  expect(actions).toEqual([false, true]); // JS action stripped, URI action kept
});

test("unticked categories are left alone", async () => {
  const { bytes, removed } = await sanitizePdf(await dirtyDoc(), {
    ...DEFAULT_SANITIZE,
    comments: false,
    bookmarks: false,
  });
  expect(removed.comments).toBe(0);
  expect(removed.bookmarks).toBe(0);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(out.catalog.has(PDFName.of("Outlines"))).toBe(true);
  // The note, the JS link and the URL link all survive.
  expect((out.getPage(0).node.Annots() as PDFArray).size()).toBe(3);
});

test("hidden layers are reported but never removed", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const ctx = doc.context;
  const layer = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Secret") }));
  doc.catalog.set(
    PDFName.of("OCProperties"),
    ctx.obj({ OCGs: [layer], D: { OFF: [layer], Order: [layer] } }),
  );

  const { bytes, removed } = await sanitizePdf(await doc.save(), DEFAULT_SANITIZE);
  expect(removed.hiddenLayers).toBe(1);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(out.catalog.has(PDFName.of("OCProperties"))).toBe(true);
});

test("describeRemoved reads as a sentence", () => {
  const zero = {
    metadata: 0,
    attachments: 0,
    javascript: 0,
    comments: 0,
    bookmarks: 0,
    hiddenLayers: 0,
  };
  expect(describeRemoved(zero)).toBe("");
  expect(describeRemoved({ ...zero, comments: 1 })).toBe("1 comment");
  expect(describeRemoved({ ...zero, comments: 3, attachments: 1, metadata: 2 })).toBe(
    "3 comments, 1 attachment and metadata",
  );
});
