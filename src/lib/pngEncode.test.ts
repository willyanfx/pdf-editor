import { expect, test } from "vite-plus/test";
import { encodePng } from "./pngEncode";

/** Inflate the single IDAT chunk of a PNG produced by encodePng. */
async function rawScanlines(png: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(png.buffer, png.byteOffset);
  let pos = 8;
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    if (type === "IDAT") {
      const stream = new Blob([png.slice(pos + 8, pos + 8 + len)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    pos += 12 + len;
  }
  throw new Error("no IDAT");
}

test("encodePng writes an opaque image as RGB", async () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 8, 7, 255,
  ]);
  const png = await encodePng({ width: 2, height: 2, rgba, hasAlpha: false });

  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  expect(view.getUint32(16)).toBe(2); // width
  expect(view.getUint32(20)).toBe(2); // height
  expect(png[24]).toBe(8); // bit depth
  expect(png[25]).toBe(2); // colour type RGB

  expect(Array.from(await rawScanlines(png))).toEqual([
    0,
    255,
    0,
    0,
    0,
    255,
    0, // row 1: filter + 2 RGB pixels
    0,
    0,
    0,
    255,
    9,
    8,
    7, // row 2
  ]);
});

test("encodePng keeps the alpha channel when the image has one", async () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 128]);
  const png = await encodePng({ width: 1, height: 1, rgba, hasAlpha: true });
  expect(png[25]).toBe(6); // colour type RGBA
  expect(Array.from(await rawScanlines(png))).toEqual([0, 10, 20, 30, 128]);
});

test("the last chunk is IEND", async () => {
  const png = await encodePng({ width: 1, height: 1, rgba: new Uint8Array(4), hasAlpha: false });
  expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
});
