import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type RGB } from "pdf-lib";
import type { FontFamily, PdfEdit, TextEdit, TextRun } from "../store/useEditorStore";
import { runsToText } from "../store/useEditorStore";
import { mapScreenRectToPdf } from "./pdfGeometry";
import {
  isStandardFont,
  getGoogleFontEntry,
  fetchFontTtf,
  waitForFonts,
  type FontVariantKey,
} from "./fonts";

export { mapScreenRectToPdf, VIEWER_WIDTH } from "./pdfGeometry";

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

/** A drawable piece of a wrapped line: contiguous text sharing one font/size/color. */
type RenderedSegment = { text: string; font: PDFFont; fontSize: number; color: RGB };
type RenderedLine = RenderedSegment[];

function colorEqual(a: RGB, b: RGB): boolean {
  return a.red === b.red && a.green === b.green && a.blue === b.blue;
}

/** The font/size/color a run renders with, applying box defaults for omitted
 * run fields. `scale` converts screen px → PDF user units. */
async function resolveRunStyle(
  run: TextRun,
  edit: TextEdit,
  scale: number,
  getFont: (f: FontFamily, b: boolean, i: boolean) => Promise<PDFFont>,
) {
  const family = run.fontFamily ?? edit.fontFamily;
  const bold = run.bold ?? edit.bold;
  const italic = run.italic ?? edit.italic;
  const fontSize = (run.fontSize ?? edit.fontSize) * scale;
  const color = hexToRgb(run.color ?? edit.color);
  const font = await getFont(family, bold, italic);
  return { font, fontSize, color };
}

/**
 * Greedy word-wrap across runs to fit `maxWidth`. Wrapping can break mid-run;
 * each output line is a list of segments (one per font/size/color stretch).
 * Whitespace tokens are kept so wrapping behaves like the old single-font path.
 */
export async function wrapRuns(
  runs: TextRun[],
  edit: TextEdit,
  maxWidth: number,
  scale: number,
  getFont: (f: FontFamily, b: boolean, i: boolean) => Promise<PDFFont>,
): Promise<RenderedLine[]> {
  const lines: RenderedLine[] = [];
  let line: RenderedLine = [];
  let lineWidth = 0;

  const pushLine = () => {
    // Trim trailing whitespace from the line so alignment measures true width.
    while (line.length > 0) {
      const last = line[line.length - 1];
      last.text = last.text.replace(/\s+$/, "");
      if (last.text === "") line.pop();
      else break;
    }
    lines.push(line);
    line = [];
    lineWidth = 0;
  };

  /** Append text in a given style to the current line, merging with the last
   * segment when the style matches. */
  const appendToLine = (
    text: string,
    style: { font: PDFFont; fontSize: number; color: RGB },
    width: number,
  ) => {
    const last = line[line.length - 1];
    if (last && last.font === style.font && last.fontSize === style.fontSize && colorEqual(last.color, style.color)) {
      last.text += text;
    } else {
      line.push({ text, font: style.font, fontSize: style.fontSize, color: style.color });
    }
    lineWidth += width;
  };

  for (const run of runs) {
    const style = await resolveRunStyle(run, edit, scale, getFont);
    // Split on hard newlines first, then wrap each paragraph chunk.
    const paragraphs = run.text.split("\n");
    for (let p = 0; p < paragraphs.length; p++) {
      if (p > 0) pushLine(); // hard break
      const words = paragraphs[p].split(/(\s+)/).filter((w) => w !== "");
      for (const word of words) {
        const w = style.font.widthOfTextAtSize(word, style.fontSize);
        if (lineWidth > 0 && lineWidth + w > maxWidth) {
          pushLine();
          if (/^\s+$/.test(word)) continue; // drop leading space after a wrap
        }
        appendToLine(word, style, w);
      }
    }
  }
  pushLine();
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
  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();

  // Pre-warm browser font loading for any Google families in this export so
  // that canvas measurement (used by callers) uses the real face.
  const googleFamiliesUsed = Array.from(
    new Set(
      edits.flatMap((e) => {
        if (e.type !== "text") return [];
        const box = e as TextEdit;
        return [
          box.fontFamily,
          ...box.runs.map((r) => r.fontFamily).filter((f): f is string => !!f),
        ].filter((f) => !isStandardFont(f));
      }),
    ),
  );
  if (googleFamiliesUsed.length > 0) {
    await waitForFonts(googleFamiliesUsed);
  }

  // Embed each needed font once and cache it.
  const fontCache = new Map<FontKey, PDFFont>();

  /**
   * Resolve the best available variant URL for a Google font.
   *
   * Fallback chain:
   *   bi -> b -> r
   *   i  -> r
   *   b  -> r
   *   r  -> (no fallback; entry must have at least "r")
   */
  function resolveGoogleVariantUrl(
    entry: ReturnType<typeof getGoogleFontEntry> & object,
    variant: FontVariantKey,
  ): string | undefined {
    const { variants } = entry;
    if (variant === "bi") {
      return (
        variants.bi?.ttfUrl ?? variants.b?.ttfUrl ?? variants.r?.ttfUrl
      );
    }
    if (variant === "i") {
      return variants.i?.ttfUrl ?? variants.r?.ttfUrl;
    }
    if (variant === "b") {
      return variants.b?.ttfUrl ?? variants.r?.ttfUrl;
    }
    return variants.r?.ttfUrl;
  }

  const getFont = async (family: FontFamily, bold: boolean, italic: boolean): Promise<PDFFont> => {
    const variant: FontVariantKey =
      bold && italic ? "bi" : bold ? "b" : italic ? "i" : "r";
    const key = `${family}-${variant}` as FontKey;

    const cached = fontCache.get(key);
    if (cached) return cached;

    // --- standard font fast path (unchanged) ---
    if (isStandardFont(family)) {
      const { font } = standardFontFor(family, bold, italic);
      const embedded = await pdfDoc.embedFont(font);
      fontCache.set(key, embedded);
      return embedded;
    }

    // --- Google Font path ---
    const entry = getGoogleFontEntry(family);
    const ttfUrl = entry ? resolveGoogleVariantUrl(entry, variant) : undefined;

    if (ttfUrl) {
      try {
        const bytes = await fetchFontTtf(ttfUrl);
        const embedded = await pdfDoc.embedFont(bytes, { subset: true });
        fontCache.set(key, embedded);
        return embedded;
      } catch (err) {
        console.warn(
          `[exportPdf] Failed to embed Google Font "${family}" (${variant}); falling back to Helvetica. Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      console.warn(
        `[exportPdf] No TTF URL found for "${family}" (${variant}); falling back to Helvetica.`,
      );
    }

    // Graceful fallback: use standard Helvetica matching the weight/style.
    const fallbackStdFont =
      bold && italic ? StandardFonts.HelveticaBoldOblique
      : bold         ? StandardFonts.HelveticaBold
      : italic       ? StandardFonts.HelveticaOblique
                     : StandardFonts.Helvetica;
    const fallbackKey = `Helvetica-${variant}` as FontKey;
    let fallbackEmbedded = fontCache.get(fallbackKey);
    if (!fallbackEmbedded) {
      fallbackEmbedded = await pdfDoc.embedFont(fallbackStdFont);
      fontCache.set(fallbackKey, fallbackEmbedded);
    }
    // Also register under the original key so we don't retry the failed fetch.
    fontCache.set(key, fallbackEmbedded);
    return fallbackEmbedded;
  };

  for (const edit of edits) {
    const page = pages[edit.pageIndex];
    if (!page) continue;

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const pdfRect = mapScreenRectToPdf(edit, pageWidth, pageHeight);

    if (edit.type === "text") {
      await drawTextEdit(page, edit, pdfRect.scale, pdfRect.x, pageHeight, getFont);
    }

    if (edit.type === "rectangle") {
      page.drawRectangle({
        x: pdfRect.x,
        y: pdfRect.y,
        width: pdfRect.width,
        height: pdfRect.height,
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
        x: pdfRect.x,
        y: pdfRect.y,
        width: pdfRect.width,
        height: pdfRect.height,
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

  if (runsToText(edit.runs).trim() === "") return;

  // 2. Draw the replacement text, wrapping across runs with per-run font/size/color.
  const lines = await wrapRuns(edit.runs, edit, boxW, scale, getFont);

  // Top of box in PDF space; first baseline sits one line down. Line advance uses
  // the box's font size so mixed-size runs share a consistent leading.
  const baseFontSize = edit.fontSize * scale;
  const lineHeight = baseFontSize * 1.15;
  const boxTopY = pageHeight - edit.y * scale;
  let baselineY = boxTopY - baseFontSize;

  for (const line of lines) {
    const lineWidth = line.reduce(
      (sum, seg) => sum + seg.font.widthOfTextAtSize(seg.text, seg.fontSize),
      0,
    );
    let segX = pdfX;
    if (edit.align === "center") segX = pdfX + (boxW - lineWidth) / 2;
    else if (edit.align === "right") segX = pdfX + (boxW - lineWidth);

    for (const seg of line) {
      page.drawText(seg.text, {
        x: segX,
        y: baselineY,
        size: seg.fontSize,
        font: seg.font,
        color: seg.color,
      });
      segX += seg.font.widthOfTextAtSize(seg.text, seg.fontSize);
    }
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
