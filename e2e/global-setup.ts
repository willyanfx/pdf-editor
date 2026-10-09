import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

/** Where the generated fixture PDF lands; the smoke test reads it from here. */
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".fixtures");
export const FIXTURE_PDF = join(FIXTURE_DIR, "smoke.pdf");
export const FIXTURE_HTML = join(FIXTURE_DIR, "smoke.html");
export const FEATURES_PDF = join(FIXTURE_DIR, "features.pdf");
export const FORM_PDF = join(FIXTURE_DIR, "form.pdf");
export const DIRTY_PDF = join(FIXTURE_DIR, "dirty.pdf");

/** A 1x1 opaque red PNG, so the fixture has a real embedded image. */
const RED_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  await writeFile(FEATURES_PDF, await buildFeaturesPdf());
  await writeFile(FORM_PDF, await buildFormPdf());
  await writeFile(DIRTY_PDF, await buildDirtyPdf());
}

/** One page carrying an image, author metadata, an attachment and a comment. */
async function buildDirtyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setAuthor("Secret Author");
  doc.setTitle("Internal draft");
  const page = doc.addPage([612, 792]);
  page.drawText("Visible text", { x: 72, y: 700, size: 18, font });
  page.drawImage(await doc.embedPng(Buffer.from(RED_PIXEL_PNG, "base64")), {
    x: 72,
    y: 600,
    width: 50,
    height: 50,
  });
  await doc.attach(Buffer.from("confidential"), "notes.txt", { mimeType: "text/plain" });
  const note = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [300, 600, 320, 620],
      Contents: PDFString.of("internal comment"),
    }),
  );
  page.node.set(PDFName.of("Annots"), doc.context.obj([note]));
  return doc.save();
}

/** Two pages with a fillable text field and checkbox on page 1. */
async function buildFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Name:", { x: 72, y: 700, size: 14, font });
  const form = doc.getForm();
  form
    .createTextField("applicant.name")
    .addToPage(page, { x: 130, y: 690, width: 200, height: 24 });
  form.createCheckBox("agree").addToPage(page, { x: 72, y: 640, width: 18, height: 18 });
  doc.addPage([612, 792]).drawText("Second page", { x: 72, y: 700, size: 14, font });
  return doc.save();
}

/** Three text pages for the feature specs (page numbers, bookmarks, organize). */
async function buildFeaturesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ["Alpha page", "Bravo page", "Charlie page"]) {
    const page = doc.addPage([612, 792]);
    page.drawText(label, { x: 72, y: 700, size: 18, font });
  }
  return doc.save();
}
