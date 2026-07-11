import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** Where the generated fixture PDF lands; the smoke test reads it from here. */
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".fixtures");
export const FIXTURE_PDF = join(FIXTURE_DIR, "smoke.pdf");
export const FIXTURE_HTML = join(FIXTURE_DIR, "smoke.html");

/** Static HTML (inline styles, no remote assets) for the HTML→PDF conversion test. */
const FIXTURE_HTML_SOURCE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Smoke</title></head>
  <body style="font-family: sans-serif">
    <h1 style="color: #1a4a8a">Hello from HTML</h1>
    <p>This static page becomes a one-page PDF.</p>
  </body>
</html>
`;

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
  await writeFile(FIXTURE_HTML, FIXTURE_HTML_SOURCE);
}
