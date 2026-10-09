import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFRawStream,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFBool,
  PDFArray,
  decodePDFRawStream,
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

import type { Bookmark } from "./bookmarks";
import { writeOutline } from "./outline";

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
  /** Bookmarks to write as the output's outline (replacing the file's own).
   * Omit to leave the outline untouched; see bookmarksForExport(). */
  bookmarks?: Bookmark[];
};

import { COMPRESS_PRESETS } from "./compressPresets";
import type { CompressOptions } from "./compressPresets";
// Re-exported so existing callers can keep importing from exportPdf; UI code
// should import from compressPresets directly to stay off the heavy chunk.
export type { CompressPreset, CompressOptions } from "./compressPresets";
export { COMPRESS_PRESETS } from "./compressPresets";

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

  if (options.bookmarks) writeOutline(pdfDoc, options.bookmarks, origToOut);

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
  compressOptions: CompressOptions = COMPRESS_PRESETS.ebook,
): Promise<Uint8Array> {
  const edited = await exportEditedPdf(sourceFile, edits, { ...options, compress: true });
  try {
    if (compressOptions.mode === "rasterize") {
      const downsampled = await downsampleImages(
        edited,
        compressOptions.targetPx,
        compressOptions.quality,
        compressOptions.grayscale,
      );
      return downsampled ?? edited;
    } else {
      return await selectiveReencodeImages(edited, compressOptions);
    }
  } catch (err) {
    console.warn("[exportPdf] image compression skipped:", err);
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
async function downsampleImages(
  pdfBytes: Uint8Array,
  targetPx = 1240,
  quality = 0.7,
  grayscale = false,
): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null; // no canvas (e.g. tests)
  // Use the shared loader (react-pdf's pdfjs instance) so the worker, wasmUrl,
  // and document-password config can't drift from the viewer's — a bare
  // import("pdfjs-dist") here can resolve a second pdfjs instance whose
  // GlobalWorkerOptions were never set, and getDocument then never resolves.
  const { loadPdfDocument } = await import("./pdfOptions");
  const loadingTask = await loadPdfDocument(pdfBytes.slice());
  const doc = await loadingTask.promise;

  const out = await PDFDocument.create();

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      // targetPx is the longest-edge limit — honour it for both landscape and portrait.
      const scale = Math.min(1, targetPx / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // White matte so transparent regions don't turn black in JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (grayscale) {
        ctx.filter = "grayscale(1)";
      }
      // intent "print" renders without requestAnimationFrame scheduling —
      // display intent stalls indefinitely while the tab is hidden (rAF is
      // throttled to zero), hanging the whole compression if the user
      // switches tabs mid-export.
      await page.render({ canvas, viewport, intent: "print" }).promise;
      if (grayscale) {
        ctx.filter = "none";
      }

      const jpegUrl = canvas.toDataURL("image/jpeg", quality);
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

/**
 * Convert raw scanline data (1/3/4-channel) to RGBA Uint8ClampedArray.
 * For CMYK (4-channel), PDF stores complemented CMYK — invert each channel
 * before converting to RGB.
 */
function rgbToRgba(
  src: Uint8Array,
  w: number,
  h: number,
  channels: number,
  bpc: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4) as Uint8ClampedArray<ArrayBuffer>;
  // For bpc=16 each channel sample occupies 2 bytes (big-endian) in src.
  // bytesPerSample drives the byte stride and normalisation.
  const bytesPerSample = bpc <= 8 ? 1 : 2;
  const maxVal = bpc <= 8 ? (1 << bpc) - 1 : 65535;

  for (let i = 0; i < w * h; i++) {
    let r = 0,
      g = 0,
      b = 0;

    /** Read one sample for pixel i, channel c and normalise to 0–255. */
    const sample = (c: number): number => {
      const byteOffset = (i * channels + c) * bytesPerSample;
      const raw =
        bytesPerSample === 1 ? src[byteOffset] : (src[byteOffset] << 8) | src[byteOffset + 1];
      return Math.round((raw / maxVal) * 255);
    };

    if (channels === 1) {
      // Grayscale
      const v = sample(0);
      r = g = b = v;
    } else if (channels === 3) {
      // RGB
      r = sample(0);
      g = sample(1);
      b = sample(2);
    } else if (channels === 4) {
      // CMYK: PDF stores complemented values (0=full ink, maxVal=no ink).
      const c = sample(0) / 255;
      const m = sample(1) / 255;
      const y = sample(2) / 255;
      const k = sample(3) / 255;
      r = Math.round(255 * (1 - c) * (1 - k));
      g = Math.round(255 * (1 - m) * (1 - k));
      b = Math.round(255 * (1 - y) * (1 - k));
    } else {
      // Fallback: treat as grayscale using first channel
      const v = sample(0);
      r = g = b = v;
    }

    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Re-encode only raster image XObjects in the PDF, preserving text and vectors.
 * Uses OffscreenCanvas (main thread or worker) to scale and re-compress each image.
 */
async function selectiveReencodeImages(
  pdfBytes: Uint8Array,
  opts: CompressOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const ctx = pdfDoc.context;

  // Strip metadata if requested.
  if (opts.stripMetadata) {
    ctx.trailerInfo.Info = undefined;
    const catalog = ctx.lookup(ctx.trailerInfo.Root);
    if (catalog && "get" in catalog && "delete" in catalog) {
      const metaRef = (catalog as { get: (k: unknown) => unknown }).get(PDFName.of("Metadata"));
      if (metaRef instanceof PDFRef) {
        (catalog as { delete: (k: unknown) => void }).delete(PDFName.of("Metadata"));
        ctx.delete(metaRef);
      }
    }
    // Strip thumbnail images from pages.
    const pages = pdfDoc.getPages();
    for (const page of pages) {
      const thumbRef = page.node.get(PDFName.of("Thumb"));
      if (thumbRef instanceof PDFRef) {
        page.node.delete(PDFName.of("Thumb"));
        ctx.delete(thumbRef);
      }
    }
  }

  // Guard: skip image pass if no canvas available (e.g., Node test environment).
  const hasCanvas = typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined";
  if (!hasCanvas) {
    return pdfDoc.save({ useObjectStreams: true });
  }

  const { targetPx, quality, grayscale } = opts;
  // PDFName.asString() returns the encoded name INCLUDING the leading solidus.
  const SKIP_FILTERS = new Set(["/CCITTFaxDecode", "/JBIG2Decode", "/JPXDecode"]);
  const SKIP_COLOR_SPACES = new Set(["/Indexed", "/Separation"]);

  const objects = ctx.enumerateIndirectObjects();
  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;

    // Only process Image XObjects.
    const subtype = dict.get(PDFName.of("Subtype"));
    if (!subtype || subtype.toString() !== "/Image") continue;

    // Skip image masks.
    const imageMask = dict.get(PDFName.of("ImageMask"));
    if (imageMask instanceof PDFBool && imageMask.asBoolean()) continue;

    // Skip unsupported filters.
    const filterEntry = dict.get(PDFName.of("Filter"));
    let filterName: string | null = null;
    if (filterEntry instanceof PDFName) {
      filterName = filterEntry.asString();
    } else if (filterEntry instanceof PDFArray) {
      // Multi-filter chains (e.g. [/FlateDecode /DCTDecode]) can't take the
      // JPEG fast path (contents are still wrapped in the outer filter) and
      // decodePDFRawStream can't unwrap DCT — leave chained images untouched.
      if (filterEntry.size() > 1) continue;
      const only = filterEntry.get(0);
      if (only instanceof PDFName) filterName = only.asString();
    }
    if (filterName && SKIP_FILTERS.has(filterName)) continue;

    // Skip indexed/separation color spaces.
    const csEntry = dict.get(PDFName.of("ColorSpace"));
    let csName: string | null = null;
    if (csEntry instanceof PDFName) {
      csName = csEntry.asString();
    } else if (csEntry instanceof PDFArray) {
      const first = csEntry.get(0);
      if (first instanceof PDFName) csName = first.asString();
    }
    if (csName && SKIP_COLOR_SPACES.has(csName)) continue;

    // Get dimensions.
    const widthEntry = dict.get(PDFName.of("Width"));
    const heightEntry = dict.get(PDFName.of("Height"));
    const pixW = widthEntry instanceof PDFNumber ? widthEntry.asNumber() : 0;
    const pixH = heightEntry instanceof PDFNumber ? heightEntry.asNumber() : 0;
    if (pixW <= 0 || pixH <= 0) continue;

    // Skip tiny images (icons, decorative).
    if (pixW * pixH < 10_000) continue;

    // Skip images that are already smaller than target and at max quality.
    const longestEdge = Math.max(pixW, pixH);
    if (longestEdge <= targetPx && quality >= 0.99) continue;

    // Skip images with SMask (alpha channel) to avoid dimension mismatch.
    const smask = dict.get(PDFName.of("SMask"));
    if (smask instanceof PDFRef) continue;

    // Compute output dimensions.
    const scale = Math.min(1, targetPx / longestEdge);
    const dstW = Math.max(1, Math.round(pixW * scale));
    const dstH = Math.max(1, Math.round(pixH * scale));

    let imageBitmap: ImageBitmap | null = null;

    try {
      if (filterName === "/DCTDecode") {
        // JPEG — read contents directly without decodePDFRawStream (which throws on DCT).
        // slice() produces a Uint8Array<ArrayBuffer> which Blob accepts.
        const jpegBytes = obj.contents.slice();
        const blob = new Blob([jpegBytes], { type: "image/jpeg" });
        imageBitmap = await createImageBitmap(blob);
      } else {
        // Other filter or no filter — decode raw scanlines.
        let bpc = 8;
        const bpcEntry = dict.get(PDFName.of("BitsPerComponent"));
        if (bpcEntry instanceof PDFNumber) bpc = bpcEntry.asNumber();
        // rgbToRgba reads whole-byte samples; sub-byte packed data (1/2/4-bit)
        // would be misread — leave those images untouched.
        if (bpc < 8) continue;

        // Determine channel count from the color space; ICCBased carries it in
        // the profile stream's /N entry. Unknown spaces are left untouched
        // rather than guessed — a wrong channel count corrupts the image.
        let channels: number | null = null;
        if (csName === "/DeviceGray" || csName === "/CalGray") channels = 1;
        else if (csName === "/DeviceRGB" || csName === "/CalRGB") channels = 3;
        else if (csName === "/DeviceCMYK") channels = 4;
        else if (csName === "/ICCBased" && csEntry instanceof PDFArray) {
          const profile = ctx.lookup(csEntry.get(1));
          if (profile instanceof PDFRawStream) {
            const n = profile.dict.get(PDFName.of("N"));
            if (n instanceof PDFNumber) channels = n.asNumber();
          }
        }
        if (channels === null) continue;

        // decode() returns Uint8Array; use directly (no need to go through .buffer).
        const decoded = decodePDFRawStream(obj).decode();
        const rgba = rgbToRgba(decoded, pixW, pixH, channels, bpc);
        const imageData = new ImageData(rgba, pixW, pixH);
        imageBitmap = await createImageBitmap(imageData);
      }

      // Re-encode using OffscreenCanvas.
      const canvas = new OffscreenCanvas(dstW, dstH);
      const canvasCtx = canvas.getContext("2d");
      if (!canvasCtx) continue;

      if (grayscale) {
        (canvasCtx as OffscreenCanvasRenderingContext2D).filter = "grayscale(1)";
      }
      canvasCtx.drawImage(imageBitmap, 0, 0, dstW, dstH);
      imageBitmap.close();
      imageBitmap = null;

      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      const newJpegBytes = new Uint8Array(await blob.arrayBuffer());

      // Always use DeviceRGB: convertToBlob always produces a 3-channel YCbCr JPEG
      // regardless of the grayscale filter applied to the canvas. Declaring
      // DeviceGray (1-component) for a 3-component JPEG stream causes rendering
      // failures in Acrobat, Ghostscript, iOS PDFKit, and strict PDF.js builds.
      const colorSpaceName = "DeviceRGB";
      const newStream = ctx.stream(newJpegBytes, {
        Type: "XObject",
        Subtype: "Image",
        Width: dstW,
        Height: dstH,
        ColorSpace: colorSpaceName,
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      });
      ctx.assign(ref, newStream);
    } catch (imgErr) {
      // If one image fails, skip it and continue with the others.
      console.warn("[exportPdf] selective re-encode skipped for image:", imgErr);
      if (imageBitmap) {
        imageBitmap.close();
      }
    }
  }

  return pdfDoc.save({ useObjectStreams: true });
}

/**
 * Estimate the compressed size of a PDF after applying the given options.
 * Returns 0 for rasterize mode (unpredictable). Useful for the dialog's live
 * preview before the user clicks Compress.
 */
export async function estimateCompressedSize(
  pdfBytes: Uint8Array,
  opts: CompressOptions,
): Promise<number> {
  if (opts.mode === "rasterize") return 0;

  const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const ctx = pdfDoc.context;
  const { targetPx, quality } = opts;

  let totalImageBytes = 0;
  let estimatedImageBytes = 0;

  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of("Subtype"));
    if (!subtype || subtype.toString() !== "/Image") continue;

    const imgSize = obj.contents.length;
    totalImageBytes += imgSize;

    const widthEntry = dict.get(PDFName.of("Width"));
    const heightEntry = dict.get(PDFName.of("Height"));
    const pixW = widthEntry instanceof PDFNumber ? widthEntry.asNumber() : 0;
    const pixH = heightEntry instanceof PDFNumber ? heightEntry.asNumber() : 0;
    const longestEdge = Math.max(pixW, pixH);

    if (longestEdge > 0 && (longestEdge > targetPx || quality < 0.99)) {
      const retainRatio = Math.min(1, Math.pow(targetPx / 2480, 2) * quality * 0.55);
      estimatedImageBytes += imgSize * retainRatio;
    } else {
      estimatedImageBytes += imgSize;
    }
  }

  const savedImageBytes = totalImageBytes - estimatedImageBytes;
  // Metadata savings estimate (rough: ~4 KB if stripping).
  const metadataSavings = opts.stripMetadata ? 4096 : 0;

  return Math.max(0, pdfBytes.length - savedImageBytes - metadataSavings);
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
