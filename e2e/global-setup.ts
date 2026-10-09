import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFString,
  StandardFonts,
  rgb,
} from "pdf-lib";

/** Where the generated fixture PDF lands; the smoke test reads it from here. */
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".fixtures");
export const FIXTURE_PDF = join(FIXTURE_DIR, "smoke.pdf");
export const FIXTURE_HTML = join(FIXTURE_DIR, "smoke.html");
export const FEATURES_PDF = join(FIXTURE_DIR, "features.pdf");
export const FORM_PDF = join(FIXTURE_DIR, "form.pdf");
export const VIEWER_PDF = join(FIXTURE_DIR, "viewer.pdf");
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
  await writeFile(VIEWER_PDF, await buildViewerPdf());
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

/**
 * Six text pages ("Page 1" … "Page 6", each with a word to search for) plus the
 * viewer features' inputs: two document-level attachments, one attachment pinned
 * to page 2, and two layers ("Red box" / "Blue box") drawn on page 1.
 */
async function buildViewerPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const words = ["Cat", "concatenate", "cat", "Dog", "dog", "Bird"];
  const pages = words.map((word, i) => {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 24, font });
    page.drawText(`Word: ${word}`, { x: 72, y: 660, size: 16, font });
    return page;
  });

  // Layers: two optional content groups, both on by default.
  const red = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Red box") }));
  const blue = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Blue box") }));
  doc.catalog.set(
    PDFName.of("OCProperties"),
    ctx.obj({ OCGs: [red, blue], D: { Order: [red, blue], ON: [red, blue] } }),
  );
  const first = pages[0];
  first.node.Resources()?.set(PDFName.of("Properties"), ctx.obj({ MC0: red, MC1: blue }));
  const layered = (tag: string, draw: () => void) => {
    first.pushOperators(PDFOperator.of("BDC" as never, [PDFName.of("OC"), PDFName.of(tag)]));
    draw();
    first.pushOperators(PDFOperator.of("EMC" as never));
  };
  layered("MC0", () =>
    first.drawRectangle({ x: 72, y: 400, width: 160, height: 120, color: rgb(0.85, 0.1, 0.1) }),
  );
  layered("MC1", () =>
    first.drawRectangle({ x: 300, y: 400, width: 160, height: 120, color: rgb(0.1, 0.2, 0.85) }),
  );

  await doc.attach(new TextEncoder().encode("Project notes\n"), "notes.txt", {
    mimeType: "text/plain",
    description: "Project notes",
  });
  await doc.attach(new TextEncoder().encode("a,b\n1,2\n"), "data.csv", {
    mimeType: "text/csv",
  });

  // A file pinned to page 2 by a FileAttachment annotation.
  const embedded = ctx.register(
    ctx.flateStream(new TextEncoder().encode("pinned"), { Type: "EmbeddedFile" }),
  );
  const spec = ctx.register(
    ctx.obj({
      Type: "Filespec",
      F: PDFString.of("pinned.txt"),
      UF: PDFHexString.fromText("pinned.txt"),
      EF: { F: embedded },
      Desc: PDFString.of("Pinned to page two"),
    }),
  );
  const annot = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "FileAttachment",
      Rect: [500, 700, 520, 720],
      FS: spec,
      Name: "PushPin",
      F: 4,
    }),
  );
  pages[1].node.set(PDFName.of("Annots"), ctx.obj([annot]));
  return doc.save();
}
