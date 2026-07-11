import { expect, test, vi } from "vite-plus/test";

// Mock heic-to before module imports so heicToPdf() never touches real WASM.
vi.mock("heic-to", () => ({
  heicTo: vi.fn(),
}));

// Mock the HTML pipeline: it needs a real DOM (iframe + html2canvas-pro),
// which the Node test environment doesn't have. Routing is what's under test.
vi.mock("./htmlToPdf", () => ({
  htmlToPdf: vi.fn(),
}));

import { heicTo } from "heic-to";
import { htmlToPdf } from "./htmlToPdf";
import { isConvertible, convertToPdf, CONVERTIBLE_ACCEPT } from "./convertToPdf";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid JPEG Uint8Array that pdf-lib's JpegEmbedder accepts.
 *
 * Structure:
 *   [SOI] [SOF0 segment]
 *
 * The JPEG parser in pdf-lib (JpegEmbedder.ts) scans forward from byte 2,
 * reading (marker, length) pairs until it hits an SOFx marker, then reads
 * the SOF payload: 2-byte length, 1-byte precision, 2-byte height,
 * 2-byte width, 1-byte nComponents. The length field in each non-SOF segment
 * includes the 2 length bytes themselves.
 *
 * SOF0 length for 3-component (RGB) JPEG = 8 + 3*3 = 17.
 */
function makeMinimalJpeg(): Uint8Array {
  // SOF0 payload: precision=8, height=1, width=1, nComponents=3 (RGB)
  // Per-component data: id, h/v sampling, quant table id (3 bytes each)
  const sof0Payload = new Uint8Array([
    0x00,
    0x11, // length = 17 (includes these 2 bytes)
    0x08, // bits per component (precision)
    0x00,
    0x01, // height = 1
    0x00,
    0x01, // width = 1
    0x03, // number of components = 3 (RGB)
    0x01,
    0x11,
    0x00, // component 1
    0x02,
    0x11,
    0x01, // component 2
    0x03,
    0x11,
    0x01, // component 3
  ]);

  const bytes = new Uint8Array(2 + 2 + sof0Payload.length);
  let i = 0;
  bytes[i++] = 0xff;
  bytes[i++] = 0xd8; // SOI
  bytes[i++] = 0xff;
  bytes[i++] = 0xc0; // SOF0 marker
  bytes.set(sof0Payload, i);
  return bytes;
}

/** Build a minimal 1×1 PNG Uint8Array for the regression test. */
async function makeMinimalPngFile(): Promise<File> {
  // A real 1x1 PNG — constructed via pdf-lib's embedPng round-trip isn't
  // feasible, so use a known-good minimal PNG (67 bytes, RGB, 1x1).
  // prettier-ignore
  const png = new Uint8Array([
    0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, // PNG signature
    0x00,0x00,0x00,0x0d,                       // IHDR length
    0x49,0x48,0x44,0x52,                       // "IHDR"
    0x00,0x00,0x00,0x01,                       // width = 1
    0x00,0x00,0x00,0x01,                       // height = 1
    0x08,0x02,                                 // bit depth=8, color type=2 (RGB)
    0x00,0x00,0x00,                            // compression, filter, interlace
    0x90,0x77,0x53,0xde,                       // IHDR CRC
    0x00,0x00,0x00,0x0c,                       // IDAT length
    0x49,0x44,0x41,0x54,                       // "IDAT"
    0x08,0xd7,0x63,0xf8,0xcf,0xc0,0x00,0x00,  // compressed scanline (1 red pixel)
    0x00,0x02,0x00,0x01,
    0xe2,0x21,0xbc,0x33,                       // IDAT CRC
    0x00,0x00,0x00,0x00,                       // IEND length
    0x49,0x45,0x4e,0x44,                       // "IEND"
    0xae,0x42,0x60,0x82,                       // IEND CRC
  ]);
  return new File([png], "test.png", { type: "image/png" });
}

// ---------------------------------------------------------------------------
// CONVERTIBLE_ACCEPT
// ---------------------------------------------------------------------------

test("CONVERTIBLE_ACCEPT includes heic and heif mime types and extensions", () => {
  expect(CONVERTIBLE_ACCEPT).toContain(".heic");
  expect(CONVERTIBLE_ACCEPT).toContain(".heif");
  expect(CONVERTIBLE_ACCEPT).toContain("image/heic");
  expect(CONVERTIBLE_ACCEPT).toContain("image/heif");
});

// ---------------------------------------------------------------------------
// isConvertible
// ---------------------------------------------------------------------------

test("isConvertible returns true for .heic with empty mime", () => {
  expect(isConvertible(new File([], "photo.heic", { type: "" }))).toBe(true);
});

test("isConvertible returns true for .heic with image/heic mime", () => {
  expect(isConvertible(new File([], "photo.heic", { type: "image/heic" }))).toBe(true);
});

test("isConvertible returns true for .heif with image/heif mime", () => {
  expect(isConvertible(new File([], "photo.heif", { type: "image/heif" }))).toBe(true);
});

test("isConvertible returns true for .heic with application/octet-stream mime", () => {
  expect(isConvertible(new File([], "photo.heic", { type: "application/octet-stream" }))).toBe(
    true,
  );
});

test("isConvertible returns true for .html and .htm", () => {
  expect(isConvertible(new File([], "page.html", { type: "text/html" }))).toBe(true);
  expect(isConvertible(new File([], "page.htm", { type: "" }))).toBe(true);
});

test("isConvertible returns false for unsupported ext", () => {
  expect(isConvertible(new File([], "video.mp4", { type: "video/mp4" }))).toBe(false);
});

// ---------------------------------------------------------------------------
// convertToPdf — HTML branch
// ---------------------------------------------------------------------------

test("CONVERTIBLE_ACCEPT includes html extensions and mime type", () => {
  expect(CONVERTIBLE_ACCEPT).toContain(".html");
  expect(CONVERTIBLE_ACCEPT).toContain(".htm");
  expect(CONVERTIBLE_ACCEPT).toContain("text/html");
});

test("convertToPdf routes .html and .htm to htmlToPdf", async () => {
  const fake = new Uint8Array([1, 2, 3]);
  (htmlToPdf as ReturnType<typeof vi.fn>).mockResolvedValue(fake);

  const html = new File(["<h1>hi</h1>"], "page.html", { type: "text/html" });
  await expect(convertToPdf(html)).resolves.toBe(fake);
  expect(htmlToPdf).toHaveBeenCalledWith(html);

  const htm = new File(["<h1>hi</h1>"], "page.htm", { type: "" });
  await expect(convertToPdf(htm)).resolves.toBe(fake);
});

// ---------------------------------------------------------------------------
// convertToPdf — HEIC branch
// ---------------------------------------------------------------------------

test("convertToPdf calls heicTo with jpeg type and returns PDF bytes", async () => {
  const jpegBytes = makeMinimalJpeg();
  (heicTo as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Blob([jpegBytes.buffer as ArrayBuffer], { type: "image/jpeg" }),
  );

  const result = await convertToPdf(new File([], "photo.heic", { type: "image/heic" }));

  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.byteLength).toBeGreaterThan(0);
  expect(new TextDecoder().decode(result.slice(0, 5))).toBe("%PDF-");

  expect(heicTo).toHaveBeenCalledWith(
    expect.objectContaining({ type: "image/jpeg", quality: 0.92 }),
  );
});

test("convertToPdf routes .heif the same as .heic", async () => {
  const jpegBytes = makeMinimalJpeg();
  (heicTo as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Blob([jpegBytes.buffer as ArrayBuffer], { type: "image/jpeg" }),
  );

  const result = await convertToPdf(new File([], "photo.heif", { type: "image/heif" }));

  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.byteLength).toBeGreaterThan(0);
  expect(new TextDecoder().decode(result.slice(0, 5))).toBe("%PDF-");
  expect(heicTo).toHaveBeenCalledWith(
    expect.objectContaining({ type: "image/jpeg", quality: 0.92 }),
  );
});

test("convertToPdf propagates heicTo decode failure", async () => {
  (heicTo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("decode failed"));

  await expect(convertToPdf(new File([], "photo.heic", { type: "image/heic" }))).rejects.toThrow(
    "decode failed",
  );
});

// ---------------------------------------------------------------------------
// convertToPdf — regression: PNG still works after heic branch added
// ---------------------------------------------------------------------------

test("convertToPdf still handles .png after heic branch added", async () => {
  // heicTo should not be called for PNG.
  (heicTo as ReturnType<typeof vi.fn>).mockClear();

  const pngFile = await makeMinimalPngFile();
  const result = await convertToPdf(pngFile);

  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.byteLength).toBeGreaterThan(0);
  expect(new TextDecoder().decode(result.slice(0, 5))).toBe("%PDF-");
  expect(heicTo).not.toHaveBeenCalled();
});
