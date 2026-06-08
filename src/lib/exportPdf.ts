import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { FontFamily, PdfEdit, TextEdit } from "../store/useEditorStore";

/** Must match the on-screen render width used by <Page width={...}> in PdfViewer. */
export const VIEWER_WIDTH = 800;

type FontKey = `${FontFamily}-${"r" | "b" | "i" | "bi"}`;

/** Map our family + bold/italic flags to the matching standard PDF font. */
function standardFontFor(family: FontFamily, bold: boolean, italic: boolean) {
  const variant = bold && italic ? "bi" : bold ? "b" : italic ? "i" : "r";
  const key = `${family}-${variant}` as FontKey;
  const table: Record<FontKey, StandardFonts> = {
    "Helvetica-r": StandardFonts.Helvetica,
    "Helvetica-b": StandardFonts.HelveticaBold,
    "Helvetica-i": StandardFonts.HelveticaOblique,
    "Helvetica-bi": StandardFonts.HelveticaBoldOblique,
    "Times-r": StandardFonts.TimesRoman,
    "Times-b": StandardFonts.TimesRomanBold,
    "Times-i": StandardFonts.TimesRomanItalic,
    "Times-bi": StandardFonts.TimesRomanBoldItalic,
    "Courier-r": StandardFonts.Courier,
    "Courier-b": StandardFonts.CourierBold,
    "Courier-i": StandardFonts.CourierOblique,
    "Courier-bi": StandardFonts.CourierBoldOblique,
  };
  return { key, font: table[key] };
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full || "000000", 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Greedy word-wrap to fit `maxWidth`, splitting long words if needed. */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/(\s+)/); // keep spaces as tokens
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || line === "") {
        line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * Render the overlay edits onto a fresh copy of the original PDF and return the
 * new PDF bytes. Existing-text edits first paint a cover rectangle over the
 * original glyphs, then draw the replacement text on top.
 */
export async function exportEditedPdf(sourceFile: File, edits: PdfEdit[]): Promise<Uint8Array> {
  const originalBytes = await sourceFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();

  // Embed each needed standard font once and cache it.
  const fontCache = new Map<FontKey, PDFFont>();
  const getFont = async (family: FontFamily, bold: boolean, italic: boolean) => {
    const { key, font } = standardFontFor(family, bold, italic);
    let embedded = fontCache.get(key);
    if (!embedded) {
      embedded = await pdfDoc.embedFont(font);
      fontCache.set(key, embedded);
    }
    return embedded;
  };

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
      await drawTextEdit(page, edit, scale, pdfX, pageHeight, getFont);
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

async function drawTextEdit(
  page: ReturnType<PDFDocument["getPages"]>[number],
  edit: TextEdit,
  scale: number,
  pdfX: number,
  pageHeight: number,
  getFont: (f: FontFamily, b: boolean, i: boolean) => Promise<PDFFont>,
) {
  const boxW = edit.width * scale;

  // 1. Cover the ORIGINAL text location (existing-text edits only). This is
  // locked to where the text was at lift time — independent of edit.x/y — so
  // dragging the replacement away doesn't re-expose the original glyphs.
  if (edit.origin === "existing" && edit.coverRect) {
    const cr = edit.coverRect;
    const coverX = cr.x * scale;
    const coverY = pageHeight - (cr.y + cr.height) * scale;
    page.drawRectangle({
      x: coverX,
      y: coverY,
      width: cr.width * scale,
      height: cr.height * scale,
      color: hexToRgb(edit.coverColor),
    });
  }

  if (edit.text.trim() === "") return;

  // 2. Draw the replacement text.
  const font = await getFont(edit.fontFamily, edit.bold, edit.italic);
  const fontSize = edit.fontSize * scale;
  const lineHeight = fontSize * 1.15;
  const lines = wrapText(edit.text, font, fontSize, boxW);
  const color = hexToRgb(edit.color);

  // Top of box in PDF space; first baseline sits one line down.
  const boxTopY = pageHeight - edit.y * scale;
  let baselineY = boxTopY - fontSize;

  for (const line of lines) {
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    let lineX = pdfX;
    if (edit.align === "center") lineX = pdfX + (boxW - lineWidth) / 2;
    else if (edit.align === "right") lineX = pdfX + (boxW - lineWidth);

    page.drawText(line, {
      x: lineX,
      y: baselineY,
      size: fontSize,
      font,
      color,
    });
    baselineY -= lineHeight;
  }
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
