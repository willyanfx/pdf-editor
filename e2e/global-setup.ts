import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** Where the generated fixture PDF lands; the smoke test reads it from here. */
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".fixtures");
export const FIXTURE_PDF = join(FIXTURE_DIR, "smoke.pdf");

/**
 * Generate a tiny, deterministic two-page PDF with selectable text and a
 * "Signature:" label, so the smoke test exercises real text extraction (and,
 * later, signature-zone detection) without committing a binary blob to git.
 * Runs once before the suite.
 */
export default async function globalSetup() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ["Hello from page one.", "Signature:"]) {
    const page = doc.addPage([612, 792]); // US Letter
    page.drawText(label, { x: 72, y: 700, size: 18, font });
  }
  const bytes = await doc.save();
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(FIXTURE_PDF, bytes);
}
