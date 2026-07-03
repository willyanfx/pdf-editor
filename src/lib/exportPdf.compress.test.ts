import { expect, test } from "vite-plus/test";
import { PDFDocument } from "pdf-lib";
import { compressEditedPdf, estimateCompressedSize, COMPRESS_PRESETS } from "./exportPdf";

/** Build a minimal 1-page PDF as a File object. */
async function makeMinimalPdf(): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  // .slice() produces Uint8Array<ArrayBuffer> which File/Blob accepts.
  return new File([bytes.slice()], "test.pdf", { type: "application/pdf" });
}

/** Build a minimal 1-page PDF as a Uint8Array. */
async function makeMinimalPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

test("compressEditedPdf with selective mode returns valid PDF bytes", async () => {
  const file = await makeMinimalPdf();
  const result = await compressEditedPdf(file, [], {}, COMPRESS_PRESETS.ebook);
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.byteLength).toBeGreaterThan(0);
  // PDF header check.
  const header = new TextDecoder().decode(result.slice(0, 5));
  expect(header).toBe("%PDF-");
});

test("COMPRESS_PRESETS.screen uses selective mode with targetPx 1240", () => {
  const screen = COMPRESS_PRESETS.screen;
  expect(screen.mode).toBe("selective");
  expect(screen.targetPx).toBe(1240);
  expect(screen.quality).toBeCloseTo(0.55);
  expect(screen.stripMetadata).toBe(true);
});

test("compressEditedPdf rasterize mode falls back gracefully in Node", async () => {
  // In Vitest (Node), typeof document === "undefined", so downsampleImages returns null
  // and compressEditedPdf returns the edited bytes unchanged.
  const file = await makeMinimalPdf();
  const result = await compressEditedPdf(file, [], {}, {
    preset: "custom",
    mode: "rasterize",
    targetPx: 1240,
    quality: 0.7,
    grayscale: false,
    stripMetadata: false,
  });
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.byteLength).toBeGreaterThan(0);
  const header = new TextDecoder().decode(result.slice(0, 5));
  expect(header).toBe("%PDF-");
});

test("estimateCompressedSize returns non-negative number", async () => {
  const pdfBytes = await makeMinimalPdfBytes();
  const est = await estimateCompressedSize(pdfBytes, COMPRESS_PRESETS.ebook);
  expect(typeof est).toBe("number");
  expect(est).toBeGreaterThanOrEqual(0);
});
