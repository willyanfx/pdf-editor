import { expect, test, vi } from "vite-plus/test";
import { PDFDocument } from "pdf-lib";
import { assemblePdfFromCanvas, assemblePdfWithinBudget, A4_PX } from "./htmlToPdf";

// ---------------------------------------------------------------------------
// Node test-environment polyfills (no DOM): assemblePdfFromCanvas only reads
// width/height off the capture canvas and draws it into an OffscreenCanvas,
// so a minimal stand-in for each is enough.
// ---------------------------------------------------------------------------

/** Minimal valid JPEG (SOI + SOF0) that pdf-lib's JpegEmbedder accepts. */
function makeMinimalJpeg(): Uint8Array {
  // SOF0 payload: length=17, precision=8, 1×1, 3 components (RGB).
  // prettier-ignore
  return new Uint8Array([
    0xff, 0xd8,             // SOI
    0xff, 0xc0,             // SOF0
    0x00, 0x11, 0x08,       // length=17, precision=8
    0x00, 0x01, 0x00, 0x01, // height=1, width=1
    0x03,                   // 3 components
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]);
}

/** Valid-header JPEG padded with trailing bytes to simulate a heavy encode. */
function makePaddedJpeg(totalLength: number): Uint8Array {
  const jpeg = makeMinimalJpeg();
  const padded = new Uint8Array(totalLength);
  padded.set(jpeg);
  return padded;
}

/** A real minimal 1×1 RGB PNG (for the PNG-fallback path). */
// prettier-ignore
const MINIMAL_PNG = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0x00,0x00,0x00,0x0d, 0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01, 0x00,0x00,0x00,0x01,
  0x08,0x02, 0x00,0x00,0x00, 0x90,0x77,0x53,0xde,
  0x00,0x00,0x00,0x0c, 0x49,0x44,0x41,0x54,
  0x08,0xd7,0x63,0xf8,0xcf,0xc0,0x00,0x00, 0x00,0x02,0x00,0x01,
  0xe2,0x21,0xbc,0x33,
  0x00,0x00,0x00,0x00, 0x49,0x45,0x4e,0x44, 0xae,0x42,0x60,0x82,
]);

/** Fake capture canvas: assemblePdfFromCanvas only reads width/height. */
function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

const drawImageCalls: unknown[][] = [];

/**
 * Install an OffscreenCanvas whose convertToBlob returns whatever the given
 * encoder produces for the requested JPEG quality.
 */
function installOffscreenCanvas(
  encode: (quality: number | undefined) => { bytes: Uint8Array; type: string },
): void {
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        fillStyle: "",
        fillRect: () => {},
        drawImage: (...args: unknown[]) => {
          drawImageCalls.push(args);
        },
      };
    }
    convertToBlob(opts?: { quality?: number }): Promise<Blob> {
      const { bytes, type } = encode(opts?.quality);
      return Promise.resolve(new Blob([bytes.buffer as ArrayBuffer], { type }));
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
}

/** Shorthand: every encode returns the same bytes/type regardless of quality. */
function installFixedOffscreenCanvas(bytes: Uint8Array, type: string): void {
  installOffscreenCanvas(() => ({ bytes, type }));
}

// ---------------------------------------------------------------------------
// assemblePdfFromCanvas
// ---------------------------------------------------------------------------

test("a one-page-tall canvas becomes a single-page A4 PDF", async () => {
  installFixedOffscreenCanvas(makeMinimalJpeg(), "image/jpeg");

  const bytes = await assemblePdfFromCanvas(fakeCanvas(A4_PX.width, A4_PX.height));
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  const { width, height } = doc.getPage(0).getSize();
  expect(width).toBeCloseTo(595.28, 1);
  expect(height).toBeCloseTo(841.89, 1);
});

test("a canvas just past one page height becomes two pages", async () => {
  installFixedOffscreenCanvas(makeMinimalJpeg(), "image/jpeg");

  const bytes = await assemblePdfFromCanvas(fakeCanvas(A4_PX.width, A4_PX.height * 2));
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
});

test("page height derives from canvas width, so a 2x-scale capture pages identically", async () => {
  installFixedOffscreenCanvas(makeMinimalJpeg(), "image/jpeg");

  // 3 pages of content captured at scale 2.
  const bytes = await assemblePdfFromCanvas(fakeCanvas(A4_PX.width * 2, A4_PX.height * 2 * 3));
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(3);
});

test("slices are drawn from consecutive source offsets", async () => {
  installFixedOffscreenCanvas(makeMinimalJpeg(), "image/jpeg");
  drawImageCalls.length = 0;

  await assemblePdfFromCanvas(fakeCanvas(A4_PX.width, A4_PX.height * 2));

  // drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh): page i reads from y = i * pageHeight.
  expect(drawImageCalls.length).toBe(2);
  expect(drawImageCalls[0][2]).toBe(0);
  expect(drawImageCalls[1][2]).toBe(A4_PX.height);
});

test("an empty (zero-height) canvas still produces one valid blank page", async () => {
  installFixedOffscreenCanvas(makeMinimalJpeg(), "image/jpeg");
  drawImageCalls.length = 0;

  const bytes = await assemblePdfFromCanvas(fakeCanvas(A4_PX.width, 0));
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  // Nothing to copy from a zero-height source.
  expect(drawImageCalls.length).toBe(0);
});

test("falls back to embedPng when the browser returns a PNG blob", async () => {
  // Per spec, convertToBlob may ignore the requested image/jpeg type.
  installFixedOffscreenCanvas(MINIMAL_PNG, "image/png");

  const bytes = await assemblePdfFromCanvas(fakeCanvas(A4_PX.width, A4_PX.height));
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
});

// ---------------------------------------------------------------------------
// assemblePdfWithinBudget
// ---------------------------------------------------------------------------

test("within budget: assembles once at full quality, no recompression", async () => {
  const qualities: (number | undefined)[] = [];
  installOffscreenCanvas((quality) => {
    qualities.push(quality);
    return { bytes: makeMinimalJpeg(), type: "image/jpeg" };
  });

  const result = await assemblePdfWithinBudget(fakeCanvas(A4_PX.width, A4_PX.height), 1_000_000);
  expect(result.recompressed).toBe(false);
  expect(result.overBudget).toBe(false);
  expect(qualities).toEqual([0.88]);
});

test("over budget: re-encodes at lower quality and returns the smaller PDF", async () => {
  installOffscreenCanvas((quality) => ({
    // Full quality yields a heavy page; the fallback quality a light one.
    bytes: quality === 0.88 ? makePaddedJpeg(64 * 1024) : makeMinimalJpeg(),
    type: "image/jpeg",
  }));

  const result = await assemblePdfWithinBudget(fakeCanvas(A4_PX.width, A4_PX.height), 32 * 1024);
  expect(result.recompressed).toBe(true);
  expect(result.overBudget).toBe(false);
  expect(result.bytes.byteLength).toBeLessThan(32 * 1024);

  const doc = await PDFDocument.load(result.bytes);
  expect(doc.getPageCount()).toBe(1);
});

test("still over budget after re-encode: flags overBudget with the smaller result", async () => {
  installOffscreenCanvas((quality) => ({
    bytes: quality === 0.88 ? makePaddedJpeg(96 * 1024) : makePaddedJpeg(64 * 1024),
    type: "image/jpeg",
  }));

  const result = await assemblePdfWithinBudget(fakeCanvas(A4_PX.width, A4_PX.height), 32 * 1024);
  expect(result.recompressed).toBe(true);
  expect(result.overBudget).toBe(true);
  // The smaller of the two encodes wins.
  expect(result.bytes.byteLength).toBeLessThan(96 * 1024);
});
