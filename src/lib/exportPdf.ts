import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  degrees,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import type {
  FontFamily,
  InkEdit,
  PageOp,
  PdfEdit,
  TextEdit,
  TextRun,
} from "../store/useEditorStore";
import { runsToText } from "../store/useEditorStore";
import { mapScreenRectToPdf, VIEWER_WIDTH as VIEWER_W } from "./pdfGeometry";
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
    if (
      last &&
      last.font === style.font &&
      last.fontSize === style.fontSize &&
      colorEqual(last.color, style.color)
    ) {
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

/** Options controlling page selection/order, transforms, and output size. */
export type ExportOptions = {
  /** Original page indices in output order. When omitted, all pages in order.
   * Pages not listed are dropped from the export. */
  pageOrder?: number[];
  /** Per-page rotate/crop transforms, keyed by original page index. */
  pageOps?: PageOp[];
  /** Compress the output (object streams; images are downsampled separately). */
  compress?: boolean;
};

/**
 * Render the overlay edits onto a fresh copy of the original PDF and return the
 * new PDF bytes. Existing-text edits first paint a cover rectangle over the
 * original glyphs, then draw the replacement text on top.
 *
 * When `options.pageOrder` is given the output is rebuilt page-by-page in that
 * order (dropping unlisted pages); `options.pageOps` applies rotate/crop.
 */
export async function exportEditedPdf(
  sourceFile: File,
  edits: PdfEdit[],
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const originalBytes = await sourceFile.arrayBuffer();
  const srcDoc = await PDFDocument.load(originalBytes);
  const srcCount = srcDoc.getPageCount();

  // Default order = every page as-is. An order that differs (reordered or with
  // deletions) means we rebuild the document; the simple path keeps srcDoc.
  const order = (options.pageOrder ?? Array.from({ length: srcCount }, (_, i) => i)).filter(
    (i) => i >= 0 && i < srcCount,
  );
  const isReordered = order.length !== srcCount || order.some((origIdx, pos) => origIdx !== pos);

  let pdfDoc: PDFDocument;
  // Maps an ORIGINAL page index to its position in the output (or -1 if dropped).
  const origToOut = new Array<number>(srcCount).fill(-1);

  if (isReordered) {
    pdfDoc = await PDFDocument.create();
    const copied = await pdfDoc.copyPages(srcDoc, order);
    copied.forEach((p, pos) => {
      pdfDoc.addPage(p);
      origToOut[order[pos]] = pos;
    });
  } else {
    pdfDoc = srcDoc;
    order.forEach((origIdx, pos) => (origToOut[origIdx] = pos));
  }

  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();

  // Apply per-page rotate/crop transforms before drawing edits.
  for (const op of options.pageOps ?? []) {
    const outIdx = origToOut[op.pageIndex];
    if (outIdx < 0) continue;
    applyPageOp(pages[outIdx], op);
  }

  // Edits are stored against ORIGINAL page indices; remap to output pages and
  // drop any whose page was deleted.
  const remappedEdits = edits
    .map((e) => ({ edit: e, outIdx: origToOut[e.pageIndex] }))
    .filter((r) => r.outIdx >= 0);

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
      return variants.bi?.ttfUrl ?? variants.b?.ttfUrl ?? variants.r?.ttfUrl;
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
    const variant: FontVariantKey = bold && italic ? "bi" : bold ? "b" : italic ? "i" : "r";
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
      bold && italic
        ? StandardFonts.HelveticaBoldOblique
        : bold
          ? StandardFonts.HelveticaBold
          : italic
            ? StandardFonts.HelveticaOblique
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

  for (const { edit } of remappedEdits) {
    const page = pages[origToOut[edit.pageIndex]];
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
      // Replacing an existing PDF image: cover the original pixels first, locked
      // to the original bbox so dragging the replacement won't re-expose it.
      if (edit.origin === "existing" && edit.coverRect) {
        const cover = mapScreenRectToPdf(edit.coverRect, pageWidth, pageHeight);
        page.drawRectangle({
          x: cover.x,
          y: cover.y,
          width: cover.width,
          height: cover.height,
          color: hexToRgb(edit.coverColor ?? "#ffffff"),
        });
      }

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

    if (edit.type === "highlight") {
      // Highlight: a translucent colored fill over the marked text band.
      page.drawRectangle({
        x: pdfRect.x,
        y: pdfRect.y,
        width: pdfRect.width,
        height: pdfRect.height,
        color: hexToRgb(edit.color),
        opacity: 0.4,
      });
    }

    if (edit.type === "underline" || edit.type === "strikeout") {
      // A thin colored rule along the baseline (underline) or middle (strikeout).
      const thickness = Math.max(1, pdfRect.height * 0.08);
      const ruleY =
        edit.type === "underline" ? pdfRect.y + thickness : pdfRect.y + pdfRect.height / 2;
      page.drawLine({
        start: { x: pdfRect.x, y: ruleY },
        end: { x: pdfRect.x + pdfRect.width, y: ruleY },
        thickness,
        color: hexToRgb(edit.color),
      });
    }

    if (edit.type === "comment") {
      drawCommentMarker(page, pdfRect, edit.color);
    }

    if (edit.type === "ink") {
      drawInkEdit(page, edit, pageWidth, pageHeight);
    }
  }

  return pdfDoc.save(options.compress ? { useObjectStreams: true } : undefined);
}

/** Apply a rotate/crop transform to an output page. */
function applyPageOp(page: PDFPage, op: PageOp) {
  if (op.rotation) {
    const norm = (((Math.round(op.rotation / 90) * 90) % 360) + 360) % 360;
    if (norm) page.setRotation(degrees(norm));
  }
  if (op.crop) {
    // Crop insets are screen px at VIEWER_WIDTH; scale to PDF units. The viewer
    // renders the page at its *visual* width, which is the MediaBox height when
    // the page carries a 90°/270° /Rotate — so scale against that, not getWidth.
    // The page may already carry a non-zero crop box origin, so offset from it.
    const existingRot = ((page.getRotation().angle % 360) + 360) % 360;
    const visualWidth = existingRot % 180 === 0 ? page.getWidth() : page.getHeight();
    const scale = visualWidth / VIEWER_W;
    const box = page.getCropBox();
    const left = box.x + op.crop.left * scale;
    const bottom = box.y + op.crop.bottom * scale;
    const width = box.width - (op.crop.left + op.crop.right) * scale;
    const height = box.height - (op.crop.top + op.crop.bottom) * scale;
    if (width > 0 && height > 0) {
      page.setCropBox(left, bottom, width, height);
    }
  }
}

/** Draw a small sticky-note marker (filled square + fold) for a comment. */
function drawCommentMarker(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  color: string,
) {
  const size = Math.min(Math.max(rect.width, 14), 22);
  page.drawRectangle({
    x: rect.x,
    y: rect.y + rect.height - size,
    width: size,
    height: size,
    color: hexToRgb(color),
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 0.75,
  });
}

/** Draw a freehand ink stroke as a connected polyline. */
function drawInkEdit(page: PDFPage, edit: InkEdit, pageWidth: number, pageHeight: number) {
  if (edit.points.length < 2) return;
  const scale = pageWidth / VIEWER_W;
  // Points are relative to the edit's (x, y) in screen space; map to PDF space.
  const toPdf = (p: { x: number; y: number }) => ({
    x: (edit.x + p.x) * scale,
    y: pageHeight - (edit.y + p.y) * scale,
  });
  for (let i = 1; i < edit.points.length; i++) {
    page.drawLine({
      start: toPdf(edit.points[i - 1]),
      end: toPdf(edit.points[i]),
      thickness: edit.strokeWidth * scale,
      color: hexToRgb(edit.color),
    });
  }
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

/**
 * The Compress export: object streams + image downsampling. Loads the edited
 * bytes (after all edits are baked in) and re-encodes large raster images at a
 * lower resolution/quality, then saves with object streams on. Falls back to a
 * plain object-stream save if downsampling isn't possible in this environment.
 */
export async function compressEditedPdf(
  sourceFile: File,
  edits: PdfEdit[],
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const edited = await exportEditedPdf(sourceFile, edits, { ...options, compress: true });
  try {
    const downsampled = await downsampleImages(edited);
    return downsampled ?? edited;
  } catch (err) {
    console.warn("[exportPdf] image downsampling skipped:", err);
    return edited;
  }
}

/**
 * Re-encode the rasterized pages of a PDF at a capped resolution to shrink it.
 * Renders each page with pdf.js to a JPEG, then rebuilds a flat PDF from those
 * images. This is a pragmatic, fully client-side "reduce file size" pass — it
 * trades vector fidelity for size, mirroring Acrobat's "reduced size" option.
 * Returns null (caller keeps the original) if pdf.js can't render here.
 */
async function downsampleImages(pdfBytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null; // no canvas (e.g. tests)
  const pdfjs = await import("pdfjs-dist");
  const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice() });
  const doc = await loadingTask.promise;

  const out = await PDFDocument.create();
  const TARGET_WIDTH = 1240; // ~150 DPI for US Letter; good for sharing.
  const JPEG_QUALITY = 0.7;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1, TARGET_WIDTH / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // White matte so transparent regions don't turn black in JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;

      const jpegUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const jpeg = await out.embedJpg(dataUrlToBytes(jpegUrl));
      const outPage = out.addPage([base.width, base.height]);
      outPage.drawImage(jpeg, { x: 0, y: 0, width: base.width, height: base.height });
    }
  } finally {
    // Fully tear down the worker-side document (not just doc.cleanup(), which
    // only frees per-page caches) on every exit path — including an early
    // return or a render error mid-loop — so the worker never leaks.
    await loadingTask.destroy();
  }
  return out.save({ useObjectStreams: true });
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
