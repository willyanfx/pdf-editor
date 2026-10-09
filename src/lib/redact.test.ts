/**
 * End-to-end tests for real redaction. Each test builds a PDF containing a
 * secret, marks it, runs the full export + redaction pipeline, and then checks
 * two things with independent tools:
 *   - pdf.js text extraction (what a reader/search would see), and
 *   - a forensic sweep over every object and decoded stream in the output
 *     (what a determined extraction tool would see).
 *
 * pdf.js's legacy build renders in Node through the @napi-rs/canvas package
 * that pdfjs-dist itself depends on; we reach it through pdfjs-dist's own
 * module resolution so no extra dependency is needed.
 */
import { beforeAll, expect, test } from "vite-plus/test";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  applyRedactions,
  buildRedactTargets,
  createRedactionPass,
  exportRedactedPdf,
  type RedactDeps,
} from "./redact";
import { compressEditedPdf, exportEditedPdf } from "./exportPdf";
import { COMPRESS_PRESETS } from "./compressPresets";
import { VIEWER_WIDTH, type ScreenRect } from "./pdfGeometry";
import { makeTextEdit, textToRuns, type PdfEdit, type RedactEdit } from "../store/useEditorStore";

// ---------------------------------------------------------------------------
// pdf.js + canvas in Node
// ---------------------------------------------------------------------------

type LoadingTask = { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> };
type PdfJsModule = { getDocument(params: Record<string, unknown>): LoadingTask };
type Canvas2d = {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
};
type NapiCanvas = {
  getContext(kind: "2d"): Canvas2d;
  toBuffer(mime: "image/jpeg", quality?: number): Uint8Array;
};

const req = createRequire(import.meta.url);
const pdfjsPath = req.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const standardFontDataUrl = path.resolve(path.dirname(pdfjsPath), "../../standard_fonts") + "/";

let pdfjs: PdfJsModule;
let createCanvas: (w: number, h: number) => NapiCanvas;

beforeAll(async () => {
  pdfjs = (await import(/* @vite-ignore */ pathToFileURL(pdfjsPath).href)) as PdfJsModule;
  // pdfjs-dist resolves @napi-rs/canvas from its own location (optional dep).
  createCanvas = (
    createRequire(pdfjsPath)("@napi-rs/canvas") as { createCanvas: typeof createCanvas }
  ).createCanvas;
});

const load = (data: Uint8Array) => pdfjs.getDocument({ data: data.slice(), standardFontDataUrl });

const deps: RedactDeps = {
  loadDocument: async (data) => load(data),
  createCanvas: (w, h) => {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    return {
      canvas,
      fill(x, y, fw, fh, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, fw, fh);
      },
      toJpeg: async (q) => new Uint8Array(canvas.toBuffer("image/jpeg", Math.round(q * 100))),
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

const toFile = (bytes: Uint8Array, name = "doc.pdf") =>
  new File([bytes.slice()], name, { type: "application/pdf" });

async function buildDoc(
  build: (doc: PDFDocument, font: PDFFont) => Promise<void> | void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  await build(doc, font);
  return doc.save();
}

type UserRect = { x: number; y: number; width: number; height: number };

/** Draw text and return a user-space box around its glyphs. */
function drawText(
  page: PDFPage,
  font: PDFFont,
  str: string,
  x: number,
  y: number,
  size = 18,
): UserRect {
  page.drawText(str, { x, y, size, font });
  return {
    x: x - 1,
    y: y - size * 0.25,
    width: font.widthOfTextAtSize(str, size) + 2,
    height: size * 1.1,
  };
}

/** Project a user-space rect into the viewer's 800px space exactly as the app
 * does (pdf.js default viewport, so page rotation is honoured). */
async function viewerRect(
  bytes: Uint8Array,
  pageIndex: number,
  user: UserRect,
): Promise<ScreenRect> {
  const task = load(bytes);
  try {
    const page = await (await task.promise).getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: VIEWER_WIDTH / base.width });
    const pts = [
      [user.x, user.y],
      [user.x + user.width, user.y],
      [user.x, user.y + user.height],
      [user.x + user.width, user.y + user.height],
    ].map(([x, y]) => vp.convertToViewportPoint(x, y) as [number, number]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  } finally {
    await task.destroy();
  }
}

let markSeq = 0;
const mark = (rect: ScreenRect, pageIndex = 0): RedactEdit => ({
  id: `mark-${markSeq++}`,
  type: "redact",
  pageIndex,
  ...rect,
});

/** Text pdf.js extracts from each page. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = load(bytes);
  try {
    const doc = await task.promise;
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      out.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/** Visible page sizes (points) according to pdf.js. */
async function pageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const task = load(bytes);
  try {
    const doc = await task.promise;
    const out: { width: number; height: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
      out.push({ width: vp.width, height: vp.height });
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/** Append the decoded form of every `<hex>` string token so hex-encoded text
 * (pdf-lib writes field values and `Tj` operands that way) is searchable. */
function withDecodedHex(s: string): string {
  return s.replace(/<([0-9A-Fa-f\s]{2,})>/g, (m, h: string) => {
    const clean = h.replace(/\s/g, "");
    let out = "";
    for (let i = 0; i + 1 < clean.length; i += 2) {
      out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    }
    return `${m} ${out}`;
  });
}

/** Everything a forensic reader could recover: the raw file, every object's
 * serialized form (hex strings decoded), and every decodable stream's bytes. */
async function recoverable(bytes: Uint8Array): Promise<string> {
  const parts = [latin1(bytes)];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    parts.push(obj.toString());
    if (obj instanceof PDFRawStream) {
      try {
        parts.push(latin1(decodePDFRawStream(obj).decode()));
      } catch {
        parts.push(latin1(obj.contents));
      }
    }
  }
  return withDecodedHex(parts.join("\n"));
}

/** [width, height] of every image XObject in the file. */
async function imageSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: [number, number][] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const w = obj.dict.get(PDFName.of("Width"));
    const h = obj.dict.get(PDFName.of("Height"));
    out.push([
      w instanceof PDFNumber ? w.asNumber() : -1,
      h instanceof PDFNumber ? h.asNumber() : -1,
    ]);
  }
  return out;
}

/** Decoded content of a page's content stream(s), concatenated. */
async function pageContent(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => doc.context.lookup(r))
      : [contents];
  return streams
    .map((s) => (s instanceof PDFRawStream ? latin1(decodePDFRawStream(s).decode()) : ""))
    .join("\n");
}

/** RGB at a point (user-space coords on an unrotated page) of a rendered page. */
async function pixelAt(bytes: Uint8Array, pageIndex: number, ux: number, uy: number) {
  const task = load(bytes);
  try {
    const page = await (await task.promise).getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, intent: "print" })
      .promise;
    const [px, py] = viewport.convertToViewportPoint(ux, uy) as [number, number];
    const d = ctx.getImageData(Math.round(px), Math.round(py), 1, 1).data;
    return [d[0], d[1], d[2]];
  } finally {
    await task.destroy();
  }
}

/** A JPEG with a seeded noise pattern on `color`, so its entropy-coded bytes
 * are unique to it (JPEG headers/tables are identical across images). */
function makeJpeg(width: number, height: number, color: string): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgb(${Math.floor(rand() * 255)},${Math.floor(rand() * 255)},${Math.floor(rand() * 255)})`;
    ctx.fillRect(rand() * width, rand() * height, 4 + rand() * 20, 4 + rand() * 20);
  }
  return new Uint8Array(canvas.toBuffer("image/jpeg", 90));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("marked text is gone from the output; unmarked text stays searchable; other pages untouched", async () => {
  let secret!: UserRect;
  const src = await buildDoc((doc, font) => {
    const p1 = doc.addPage([612, 792]);
    secret = drawText(p1, font, "SECRET-ALPHA", 72, 700);
    drawText(p1, font, "Public line one", 72, 600);
    const p2 = doc.addPage([612, 792]);
    drawText(p2, font, "Page two text", 72, 700);
  });
  // Sanity: the forensic sweep can see the secret in the source.
  expect(await recoverable(src)).toContain("SECRET-ALPHA");

  const m = mark(await viewerRect(src, 0, secret));
  const { bytes, warnings, redactedPages } = await exportRedactedPdf(
    toFile(src),
    [m],
    { pageOrder: [0, 1] },
    { deps },
  );
  expect(warnings).toEqual([]);
  expect(redactedPages).toEqual([0]);

  const texts = await pageTexts(bytes);
  expect(texts[0]).not.toContain("SECRET");
  expect(texts[0]).toContain("Public line one");
  expect(texts[1]).toContain("Page two text");
  expect(await recoverable(bytes)).not.toContain("SECRET");

  // The flattened page is an image plus invisible (render mode 3) text.
  const content = await pageContent(bytes, 0);
  expect(content).toContain(" Do");
  expect(content).toContain("3 Tr");
  expect(withDecodedHex(content)).toContain("Public line one");

  // Pixels: black inside the mark, white page elsewhere.
  const inside = await pixelAt(bytes, 0, secret.x + secret.width / 2, secret.y + secret.height / 2);
  expect(Math.max(...inside)).toBeLessThan(40);
  const outside = await pixelAt(bytes, 0, 400, 400);
  expect(Math.min(...outside)).toBeGreaterThan(230);
});

test("90°-rotated page: mark drawn in the viewer's rotated space lands on the right content", async () => {
  let secret!: UserRect;
  let visible!: UserRect;
  const src = await buildDoc((doc, font) => {
    const p = doc.addPage([612, 792]);
    p.setRotation(degrees(90));
    secret = drawText(p, font, "SECRET-ROT", 72, 700);
    visible = drawText(p, font, "Visible rotated", 72, 300);
  });
  const vr = await viewerRect(src, 0, secret);
  // In the viewer the page is landscape, so the mark lives in an 800×618 space.
  const sizesBefore = await pageSizes(src);
  expect(sizesBefore[0].width).toBe(792);
  expect(vr.y).toBeGreaterThan(0);

  const { bytes, warnings } = await exportRedactedPdf(toFile(src), [mark(vr)], {}, { deps });
  expect(warnings).toEqual([]);
  const texts = await pageTexts(bytes);
  expect(texts[0]).not.toContain("SECRET");
  expect(texts[0]).toContain("Visible rotated");
  expect(await recoverable(bytes)).not.toContain("SECRET-ROT");
  // Output keeps the visible (landscape) size.
  const [size] = await pageSizes(bytes);
  expect(size.width).toBeCloseTo(792, 0);
  expect(size.height).toBeCloseTo(612, 0);
  // The unmarked text was not blacked out: its ink is still dark there.
  const probe = await viewerRect(bytes, 0, visible);
  expect(probe.width).toBeGreaterThan(0);
});

test("page with a PageOp rotation + crop: marks map through user space correctly", async () => {
  let secret!: UserRect;
  const src = await buildDoc((doc, font) => {
    const p = doc.addPage([612, 792]);
    secret = drawText(p, font, "SECRET-CROP", 72, 700);
    drawText(p, font, "Visible cropped", 72, 400);
  });
  const pageOps = [
    { pageIndex: 0, rotation: 90, crop: { top: 40, right: 20, bottom: 40, left: 20 } },
  ];
  const marks = [mark(await viewerRect(src, 0, secret))];
  const { bytes, warnings } = await exportRedactedPdf(
    toFile(src),
    marks,
    { pageOrder: [0], pageOps },
    { deps },
  );
  expect(warnings).toEqual([]);
  const texts = await pageTexts(bytes);
  expect(texts[0]).not.toContain("SECRET");
  expect(texts[0]).toContain("Visible cropped");
  expect(await recoverable(bytes)).not.toContain("SECRET-CROP");
  // The flattened page keeps exactly the visible size the export produced
  // (rotated + cropped), and that size is landscape and smaller than the sheet.
  const exported = await exportEditedPdf(toFile(src), marks, { pageOps, redactionsHandled: true });
  const [expected] = await pageSizes(exported);
  const [size] = await pageSizes(bytes);
  expect(size.width).toBeCloseTo(expected.width, 0);
  expect(size.height).toBeCloseTo(expected.height, 0);
  expect(size.width).toBeGreaterThan(size.height);
  expect(size.width).toBeLessThan(792);
  expect(size.height).toBeLessThan(612);
});

test("image under a mark: the original image XObject no longer exists anywhere in the file", async () => {
  const jpeg = makeJpeg(200, 100, "#ff0000");
  const src = await buildDoc(async (doc, font) => {
    const p = doc.addPage([612, 792]);
    const img = await doc.embedJpg(jpeg);
    p.drawImage(img, { x: 72, y: 400, width: 200, height: 100 });
    drawText(p, font, "Visible image page", 72, 300);
  });
  expect(await imageSizes(src)).toEqual([[200, 100]]);

  const { bytes, warnings } = await exportRedactedPdf(
    toFile(src),
    [mark(await viewerRect(src, 0, { x: 72, y: 400, width: 200, height: 100 }))],
    {},
    { deps },
  );
  expect(warnings).toEqual([]);
  const sizes = await imageSizes(bytes);
  expect(sizes).toHaveLength(1); // only the page raster
  expect(sizes[0][0]).toBeGreaterThan(1000);
  expect(sizes.some(([w, h]) => w === 200 && h === 100)).toBe(false);
  // Not even the JPEG's entropy-coded bytes survive anywhere in the file.
  const tail = latin1(jpeg.subarray(jpeg.length - 96, jpeg.length - 8));
  expect(latin1(src)).toContain(tail); // sanity: the source embeds the JPEG verbatim
  expect(latin1(bytes)).not.toContain(tail);
  expect((await pageTexts(bytes))[0]).toContain("Visible image page");
  // Where the image was is now black.
  const px = await pixelAt(bytes, 0, 172, 450);
  expect(Math.max(...px)).toBeLessThan(40);
});

test("image listed in a resources dict shared with another page is purged when only the redacted page drew it", async () => {
  const jpeg = makeJpeg(200, 100, "#00ff00");
  const build = async (drawOnPageTwo: boolean) =>
    buildDoc(async (doc, font) => {
      const p1 = doc.addPage([612, 792]);
      const p2 = doc.addPage([612, 792]);
      const img = await doc.embedJpg(jpeg);
      p1.drawImage(img, { x: 72, y: 400, width: 200, height: 100 });
      drawText(p1, font, "Page one", 72, 300);
      drawText(p2, font, "Page two shared", 72, 300);
      // Share page 1's resources with page 2 by reference.
      const resources = p1.node.Resources()!;
      const ref = doc.context.register(resources);
      p1.node.set(PDFName.of("Resources"), ref);
      p2.node.set(PDFName.of("Resources"), ref);
      if (drawOnPageTwo) p2.drawImage(img, { x: 72, y: 500, width: 200, height: 100 });
    });

  const markOverImage = async (src: Uint8Array) =>
    mark(await viewerRect(src, 0, { x: 72, y: 400, width: 200, height: 100 }));

  // Only page 1 draws it → it must disappear from the file.
  const srcA = await build(false);
  const a = await exportRedactedPdf(toFile(srcA), [await markOverImage(srcA)], {}, { deps });
  expect(a.warnings).toEqual([]);
  expect((await imageSizes(a.bytes)).some(([w, h]) => w === 200 && h === 100)).toBe(false);
  expect((await pageTexts(a.bytes))[1]).toContain("Page two shared");

  // Page 2 also draws it → it is legitimately visible there and must stay.
  const srcB = await build(true);
  const b = await exportRedactedPdf(toFile(srcB), [await markOverImage(srcB)], {}, { deps });
  expect(b.warnings).toEqual([]);
  expect((await imageSizes(b.bytes)).some(([w, h]) => w === 200 && h === 100)).toBe(true);
  expect(await pageContent(b.bytes, 1)).toContain(" Do");
});

test("overlay text edit under a mark is not baked; overlays outside marks are", async () => {
  const src = await buildDoc((doc, font) => {
    const p = doc.addPage([612, 792]);
    drawText(p, font, "Base text", 72, 700);
  });
  const edits: PdfEdit[] = [
    makeTextEdit({
      pageIndex: 0,
      x: 100,
      y: 200,
      width: 300,
      height: 30,
      runs: textToRuns("OVERLAY-SECRET"),
    }),
    makeTextEdit({
      pageIndex: 0,
      x: 100,
      y: 400,
      width: 300,
      height: 30,
      runs: textToRuns("OVERLAY-PUBLIC"),
    }),
    // A mark that only partially covers the first overlay.
    mark({ x: 100, y: 200, width: 40, height: 30 }),
  ];
  const { bytes } = await exportRedactedPdf(toFile(src), edits, {}, { deps });
  const all = await recoverable(bytes);
  expect(all).not.toContain("OVERLAY-SECRET");
  const texts = await pageTexts(bytes);
  expect(texts[0]).toContain("OVERLAY-PUBLIC");
  expect(texts[0]).toContain("Base text");
});

test("annotations and form fields on the redacted page are removed; other pages keep theirs", async () => {
  let secret!: UserRect;
  const src = await buildDoc((doc, font) => {
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    secret = drawText(p1, font, "SECRET-FORM", 72, 700);
    drawText(p2, font, "Second page", 72, 700);
    const annot = doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [72, 500, 92, 520],
      Contents: PDFString.of("ANNOT-SECRET"),
    });
    p1.node.addAnnot(doc.context.register(annot));
    const form = doc.getForm();
    const ssn = form.createTextField("ssn");
    ssn.setText("FIELD-SECRET");
    ssn.addToPage(p1, { x: 72, y: 450, width: 200, height: 24, font });
    const keep = form.createTextField("keep");
    keep.setText("FIELD-KEEP");
    keep.addToPage(p2, { x: 72, y: 450, width: 200, height: 24, font });
  });
  const before = await recoverable(src);
  expect(before).toContain("ANNOT-SECRET");
  expect(before).toContain("FIELD-SECRET");

  const { bytes, warnings } = await exportRedactedPdf(
    toFile(src),
    [mark(await viewerRect(src, 0, secret))],
    { pageOrder: [0, 1] },
    { deps },
  );
  expect(warnings).toEqual([]);
  const after = await recoverable(bytes);
  expect(after).not.toContain("ANNOT-SECRET");
  expect(after).not.toContain("FIELD-SECRET");
  expect(after).not.toContain("SECRET-FORM");
  expect(after).toContain("FIELD-KEEP");

  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(out.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  expect(out.getPage(1).node.Annots()?.size()).toBe(1);
  const names = out
    .getForm()
    .getFields()
    .map((f) => f.getName());
  expect(names).toEqual(["keep"]);
  expect(out.getForm().getTextField("keep").getText()).toBe("FIELD-KEEP");
});

test("a page without marks is left byte-identical by the redaction pass", async () => {
  const jpeg = makeJpeg(120, 80, "#0000ff");
  const src = await buildDoc(async (doc, font) => {
    const p1 = doc.addPage([612, 792]);
    drawText(p1, font, "Redact me", 72, 700);
    const p2 = doc.addPage([612, 792]);
    const img = await doc.embedJpg(jpeg);
    p2.drawImage(img, { x: 72, y: 400, width: 120, height: 80 });
    drawText(p2, font, "Untouched page", 72, 300);
  });
  const file = toFile(src);
  const marks = [mark(await viewerRect(src, 0, { x: 72, y: 690, width: 120, height: 30 }))];
  const exported = await exportEditedPdf(file, marks, { redactionsHandled: true });
  const { bytes, warnings } = await applyRedactions(exported, src, buildRedactTargets(marks), {
    deps,
  });
  expect(warnings).toEqual([]);

  const pageSnapshot = async (b: Uint8Array) => {
    const doc = await PDFDocument.load(b, { updateMetadata: false });
    const page = doc.getPage(1);
    const names = page.node
      .Resources()!
      .entries()
      .map(([k]) => k.decodeText())
      .sort();
    return {
      content: await pageContent(b, 1),
      names,
      keys: page.node
        .keys()
        .map((k) => k.decodeText())
        .sort(),
    };
  };
  const before = await pageSnapshot(exported);
  const after = await pageSnapshot(bytes);
  expect(after.content).toBe(before.content);
  expect(after.names).toEqual(before.names);
  expect(after.keys).toEqual(before.keys);
  expect((await imageSizes(bytes)).some(([w, h]) => w === 120 && h === 80)).toBe(true);
  expect((await pageTexts(bytes))[1]).toContain("Untouched page");
});

test("structure-tree text copies for the redacted page are pruned; other pages' tags survive", async () => {
  const src = await buildDoc((doc, font) => {
    const ctx = doc.context;
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    drawText(p1, font, "One", 72, 700);
    drawText(p2, font, "Two", 72, 700);
    // A nested span with no /Pg of its own inherits page 1 from its parent.
    const nested = ctx.register(
      ctx.obj({ Type: "StructElem", S: "Span", ActualText: PDFString.of("STRUCT-NESTED"), K: [1] }),
    );
    const e1 = ctx.register(
      ctx.obj({
        Type: "StructElem",
        S: "P",
        Pg: p1.ref,
        ActualText: PDFString.of("STRUCT-SECRET"),
        K: [0, nested],
      }),
    );
    const e2 = ctx.register(
      ctx.obj({
        Type: "StructElem",
        S: "P",
        Pg: p2.ref,
        ActualText: PDFString.of("STRUCT-KEEP"),
        K: [0],
      }),
    );
    const root = ctx.register(
      ctx.obj({
        Type: "StructTreeRoot",
        K: [e1, e2],
        ParentTree: ctx.obj({ Nums: [0, [e1], 1, [e2]] }),
        ParentTreeNextKey: 2,
      }),
    );
    doc.catalog.set(PDFName.of("StructTreeRoot"), root);
    doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
    p1.node.set(PDFName.of("StructParents"), PDFNumber.of(0));
    p2.node.set(PDFName.of("StructParents"), PDFNumber.of(1));
  });
  expect(await recoverable(src)).toContain("STRUCT-SECRET");

  const { bytes, warnings } = await exportRedactedPdf(
    toFile(src),
    [mark({ x: 50, y: 50, width: 100, height: 40 })],
    { pageOrder: [0, 1] },
    { deps },
  );
  expect(warnings).toEqual([]);
  const after = await recoverable(bytes);
  expect(after).not.toContain("STRUCT-SECRET");
  expect(after).not.toContain("STRUCT-NESTED");
  expect(after).toContain("STRUCT-KEEP");
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(out.catalog.has(PDFName.of("StructTreeRoot"))).toBe(true);
});

test("keepSearchableText: false leaves the flattened page without any text", async () => {
  const src = await buildDoc((doc, font) => {
    const p = doc.addPage([612, 792]);
    drawText(p, font, "SECRET-ONLY", 72, 700);
    drawText(p, font, "Also gone", 72, 600);
  });
  const { bytes } = await exportRedactedPdf(
    toFile(src),
    [mark({ x: 10, y: 10, width: 20, height: 20 })],
    {},
    { deps, keepSearchableText: false },
  );
  expect((await pageTexts(bytes))[0].trim()).toBe("");
  expect(await recoverable(bytes)).not.toContain("SECRET-ONLY");
});

test("compress path applies redaction through createRedactionPass", async () => {
  let secret!: UserRect;
  const src = await buildDoc((doc, font) => {
    const p = doc.addPage([612, 792]);
    secret = drawText(p, font, "SECRET-COMPRESS", 72, 700);
    drawText(p, font, "Kept after compress", 72, 600);
  });
  const file = toFile(src);
  const edits = [mark(await viewerRect(src, 0, secret))];
  const pass = createRedactionPass(file, edits, [0], { deps });
  expect(pass).not.toBeNull();
  const bytes = await compressEditedPdf(
    file,
    edits,
    { pageOrder: [0], redactionsHandled: true },
    COMPRESS_PRESETS.lossless,
    pass!.run,
  );
  expect(pass!.warnings).toEqual([]);
  expect(await recoverable(bytes)).not.toContain("SECRET-COMPRESS");
  expect((await pageTexts(bytes))[0]).toContain("Kept after compress");
});

test("buildRedactTargets follows pageOrder and merges marks per output page", () => {
  const edits: PdfEdit[] = [
    mark({ x: 1, y: 1, width: 5, height: 5 }, 0),
    mark({ x: 2, y: 2, width: 5, height: 5 }, 1), // page 1 is dropped from the export
    mark({ x: 3, y: 3, width: 5, height: 5 }, 2),
    mark({ x: 4, y: 4, width: 5, height: 5 }, 2),
    mark({ x: 0, y: 0, width: 0, height: 5 }, 2), // degenerate, ignored
  ];
  const targets = buildRedactTargets(edits, [2, 0]);
  expect(targets.map((t) => [t.outIndex, t.srcIndex, t.rects.length])).toEqual([
    [0, 2, 2],
    [1, 0, 1],
  ]);
  // Identity order when pageOrder is omitted.
  expect(buildRedactTargets(edits).map((t) => t.outIndex)).toEqual([0, 1, 2]);
});

test("exportEditedPdf refuses to bake pending redaction marks on its own", async () => {
  const src = await buildDoc((doc) => {
    doc.addPage([612, 792]);
  });
  await expect(
    exportEditedPdf(toFile(src), [mark({ x: 10, y: 10, width: 10, height: 10 })]),
  ).rejects.toThrow(/redaction/);
});
