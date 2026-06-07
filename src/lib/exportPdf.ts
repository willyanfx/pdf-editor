import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PdfEdit } from "../store/useEditorStore";

/** Must match the on-screen render width used by <Page width={...}> in PdfViewer. */
export const VIEWER_WIDTH = 800;

/**
 * Render the overlay edits onto a fresh copy of the original PDF and return the
 * new PDF bytes. We read bytes straight from the File here (rather than a shared
 * ArrayBuffer) because pdf.js neuters the buffer it receives for on-screen
 * rendering — File.arrayBuffer() always hands back a fresh, intact buffer.
 */
export async function exportEditedPdf(
  sourceFile: File,
  edits: PdfEdit[],
): Promise<Uint8Array> {
  const originalBytes = await sourceFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(originalBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const edit of edits) {
    const page = pages[edit.pageIndex];
    if (!page) continue;

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const scale = pageWidth / VIEWER_WIDTH;

    // Screen coords are top-left origin; PDF coords are bottom-left origin.
    const pdfX = edit.x * scale;
    const pdfY = pageHeight - (edit.y + edit.height) * scale;

    if (edit.type === "text") {
      const fontSize = edit.fontSize * scale;
      page.drawText(edit.text, {
        x: pdfX,
        // Place baseline near the top of the box so wrapped text grows downward.
        y: pdfY + edit.height * scale - fontSize,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: edit.width * scale,
        lineHeight: fontSize * 1.15,
      });
    }

    if (edit.type === "rectangle") {
      page.drawRectangle({
        x: pdfX,
        y: pdfY,
        width: edit.width * scale,
        height: edit.height * scale,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
    }

    if (edit.type === "image") {
      const imageBytes = dataUrlToBytes(edit.dataUrl);
      const image = edit.dataUrl.startsWith("data:image/png")
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);

      page.drawImage(image, {
        x: pdfX,
        y: pdfY,
        width: edit.width * scale,
        height: edit.height * scale,
      });
    }
  }

  return pdfDoc.save();
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
