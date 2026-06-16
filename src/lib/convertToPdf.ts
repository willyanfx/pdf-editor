import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/** Page geometry for generated (text/sheet) PDFs: US Letter with 1" margins. */
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const FONT_SIZE = 11;
const LINE_HEIGHT = FONT_SIZE * 1.4;

/** Office MIME types and extensions we can convert client-side. */
export const CONVERTIBLE_ACCEPT =
  ".docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-excel,text/csv,image/png,image/jpeg";

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** True for files convertToPdf() can handle (used to route drops/picks). */
export function isConvertible(file: File): boolean {
  const ext = extOf(file.name);
  return ["docx", "xlsx", "xls", "csv", "png", "jpg", "jpeg"].includes(ext);
}

/**
 * Convert a non-PDF file (image, Word .docx, Excel .xlsx/.csv) into PDF bytes.
 * Throws for unsupported types. Pure client-side; no upload.
 */
export async function convertToPdf(file: File): Promise<Uint8Array> {
  const ext = extOf(file.name);
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return imageToPdf(file);
  if (ext === "docx") return docxToPdf(file);
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return spreadsheetToPdf(file);
  throw new Error(`Unsupported file type: .${ext}`);
}

/** One image → one page sized to fit the image within margins. */
async function imageToPdf(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFDocument.create();
  const isPng = file.type === "image/png" || extOf(file.name) === "png";
  const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

  const maxW = PAGE_W - MARGIN;
  const maxH = PAGE_H - MARGIN;
  const ratio = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = image.width * ratio;
  const h = image.height * ratio;

  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawImage(image, {
    x: (PAGE_W - w) / 2,
    y: (PAGE_H - h) / 2,
    width: w,
    height: h,
  });
  return doc.save();
}

/** Word .docx → text-laid-out PDF (mammoth extracts raw text). */
async function docxToPdf(file: File): Promise<Uint8Array> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  const paragraphs = value.split(/\r?\n/);
  return layoutTextPdf(paragraphs);
}

/** Excel/CSV → a monospaced table-ish text dump, one PDF section per sheet. */
async function spreadsheetToPdf(file: File): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: "array" });
  const lines: string[] = [];
  for (const sheetName of wb.SheetNames) {
    lines.push(`# ${sheetName}`);
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
    for (const row of rows) {
      // Pad cells into fixed-width columns and join with spaces (WinAnsi standard
      // fonts can't encode tab 0x09), then render with the monospace Courier path.
      lines.push(
        (row ?? [])
          .map((c) =>
            String(c ?? "")
              .padEnd(16)
              .slice(0, 16),
          )
          .join(" "),
      );
    }
    lines.push("");
  }
  return layoutTextPdf(lines, true);
}

/**
 * Strip characters a WinAnsi standard font can't encode: tabs become spaces and
 * any remaining control characters are dropped, so a stray byte in a document
 * never crashes the whole conversion.
 */
function sanitize(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\t") out += "    ";
    else if (code < 32 || code === 127) continue;
    else out += ch;
  }
  return out;
}

/**
 * Flow an array of paragraph strings onto US-Letter pages with word wrap,
 * creating new pages as needed. `mono` uses Courier (better for tabular data).
 */
async function layoutTextPdf(paragraphs: string[], mono = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(mono ? StandardFonts.Courier : StandardFonts.Helvetica);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const maxWidth = PAGE_W - MARGIN * 2;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const drawLine = (text: string) => {
    if (y < MARGIN) newPage();
    page.drawText(sanitize(text), {
      x: MARGIN,
      y,
      size: FONT_SIZE,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= LINE_HEIGHT;
  };

  for (const para of paragraphs) {
    if (para === "") {
      y -= LINE_HEIGHT; // blank line
      if (y < MARGIN) newPage();
      continue;
    }
    for (const wrapped of wrapText(sanitize(para), font, FONT_SIZE, maxWidth)) {
      drawLine(wrapped);
    }
  }
  return doc.save();
}

/** Greedy word wrap to fit maxWidth at the given font/size. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/(\s+)/)) {
    const candidate = line + word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line.trim() !== "") {
      out.push(line.replace(/\s+$/, ""));
      line = word.replace(/^\s+/, "");
    } else {
      line = candidate;
    }
  }
  if (line.trim() !== "") out.push(line.replace(/\s+$/, ""));
  return out.length ? out : [""];
}
