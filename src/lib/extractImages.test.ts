import { beforeAll, expect, test } from "vite-plus/test";
import { createRequire } from "node:module";
import { PDFDict, PDFDocument, PDFName, type PDFRef } from "pdf-lib";
import { extractEmbeddedImages } from "./extractImages";
import { encodePng } from "./pngEncode";

// A real JPEG, produced by the canvas pdfjs-dist already depends on.
let jpeg: Uint8Array;
beforeAll(() => {
  const pdfjsPath = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = createRequire(pdfjsPath)("@napi-rs/canvas") as {
    createCanvas: (
      w: number,
      h: number,
    ) => {
      getContext(k: "2d"): { fillStyle: string; fillRect(...a: number[]): void };
      toBuffer(m: "image/jpeg", q: number): Uint8Array;
    };
  };
  const canvas = createCanvas(80, 60);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, 80, 60);
  jpeg = new Uint8Array(canvas.toBuffer("image/jpeg", 90));
});

/** Inflate a PNG's IDAT back to scanlines (filter byte + pixels per row). */
async function scanlines(png: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(png.buffer, png.byteOffset);
  for (let pos = 8; pos < png.length; ) {
    const len = view.getUint32(pos);
    if (String.fromCharCode(...png.subarray(pos + 4, pos + 8)) === "IDAT") {
      const stream = new Blob([png.slice(pos + 8, pos + 8 + len)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    pos += 12 + len;
  }
  throw new Error("no IDAT");
}

test("JPEG images are written out byte-for-byte", async () => {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  doc.addPage().drawImage(image, { x: 0, y: 0, width: 80, height: 60 });

  const { images, skipped } = await extractEmbeddedImages(await doc.save());
  expect(skipped).toBe(0);
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({ ext: "jpg", width: 80, height: 60, pageIndex: 0 });
  expect(Array.from(images[0].bytes)).toEqual(Array.from(jpeg));
});

test("a PNG with transparency comes back as RGBA with its alpha intact", async () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 100, 0, 0, 255, 0, 9, 9, 9, 255]);
  const source = await encodePng({ width: 2, height: 2, rgba, hasAlpha: true });
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(source);
  doc.addPage().drawImage(image, { x: 0, y: 0, width: 20, height: 20 });

  const { images } = await extractEmbeddedImages(await doc.save());
  expect(images).toHaveLength(1);
  expect(images[0].ext).toBe("png");
  const rows = await scanlines(images[0].bytes);
  expect(Array.from(rows)).toEqual([
    0, 255, 0, 0, 255, 0, 255, 0, 100, 0, 0, 0, 255, 0, 9, 9, 9, 255,
  ]);
});

/** Add a raw (unfiltered) image XObject to `page` and return its ref. */
function addRawImage(
  doc: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  data: Uint8Array,
  dict: Record<string, unknown>,
  resourceName: string,
): PDFRef {
  const ref = doc.context.register(
    doc.context.stream(data, { Type: "XObject", Subtype: "Image", ...dict } as never),
  );
  const resources = page.node.Resources()!;
  let xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) {
    xobjects = doc.context.obj({});
    resources.set(PDFName.of("XObject"), xobjects);
  }
  xobjects.set(PDFName.of(resourceName), ref);
  return ref;
}

test("indexed 4-bit images are expanded through their palette", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  // 4x1 pixels, indices 0,1,2,1 packed two per byte.
  const lookup = doc.context.stream(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]));
  const cs = doc.context.obj([
    PDFName.of("Indexed"),
    PDFName.of("DeviceRGB"),
    2,
    doc.context.register(lookup),
  ]);
  addRawImage(
    doc,
    page,
    new Uint8Array([0x01, 0x21]),
    { Width: 4, Height: 1, BitsPerComponent: 4, ColorSpace: cs },
    "Im1",
  );

  const { images } = await extractEmbeddedImages(await doc.save());
  expect(images).toHaveLength(1);
  const rows = await scanlines(images[0].bytes);
  expect(Array.from(rows)).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0]);
});

test("images on pages outside the requested set, and unused images, are not exported", async () => {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  doc.addPage().drawImage(image, { x: 0, y: 0, width: 10, height: 10 });
  doc.addPage(); // blank
  const second = await doc.embedJpg(jpeg.slice());
  doc.addPage().drawImage(second, { x: 0, y: 0, width: 10, height: 10 });
  const bytes = await doc.save();

  expect((await extractEmbeddedImages(bytes)).images).toHaveLength(2);
  const onlyLast = await extractEmbeddedImages(bytes, { pages: [2] });
  expect(onlyLast.images).toHaveLength(1);
  expect(onlyLast.images[0].pageIndex).toBe(2);
  expect((await extractEmbeddedImages(bytes, { pages: [1] })).images).toHaveLength(0);
});

test("an image shared by two pages is exported once; minSize drops small ones", async () => {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  doc.addPage().drawImage(image, { x: 0, y: 0, width: 10, height: 10 });
  doc.addPage().drawImage(image, { x: 0, y: 0, width: 10, height: 10 });
  const bytes = await doc.save();

  const all = await extractEmbeddedImages(bytes);
  expect(all.images).toHaveLength(1);
  expect(all.images[0].pageIndex).toBe(0);
  expect((await extractEmbeddedImages(bytes, { minSize: 100 })).images).toHaveLength(0);
});

test("fax-encoded images are counted as skipped, not exported", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  addRawImage(
    doc,
    page,
    new Uint8Array([0, 0, 0, 0]),
    {
      Width: 8,
      Height: 4,
      BitsPerComponent: 1,
      ColorSpace: PDFName.of("DeviceGray"),
      Filter: PDFName.of("CCITTFaxDecode"),
    },
    "Im1",
  );
  const { images, skipped } = await extractEmbeddedImages(await doc.save());
  expect(images).toHaveLength(0);
  expect(skipped).toBe(1);
});
