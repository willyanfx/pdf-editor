/**
 * Bake document-level page stamps (header/footer, page/Bates numbers,
 * watermark) into an output PDF. Called once at the end of exportEditedPdf,
 * after page ops and edits, so it sees the final page order, /Rotate and
 * CropBox and stamps on top of everything else.
 *
 * Each stamp is laid out in "reader space" (see pageStampsModel) against the
 * page's visible box, then mapped into PDF user space through the page's
 * /Rotate so the text reads upright however the page is displayed.
 */
import {
  degrees,
  rgb,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { StandardFontFamily } from "../store/useEditorStore";
import {
  fitWatermarkImage,
  hasPageStamps,
  layoutHeaderFooter,
  makeRangeTest,
  normalizeQuarterTurn,
  toStandardFontText,
  watermarkMidOffset,
  type PageStamps,
} from "./pageStampsModel";

export type PageStampExportContext = {
  /** Shown by the {filename} token. */
  fileName: string;
  /** Shown by the {date} token; defaults to now. */
  date?: Date;
};

/** A page's visible box as the reader sees it, with a mapping to user space. */
export type ReaderFrame = {
  /** Visible width/height in points, after /Rotate. */
  width: number;
  height: number;
  /** Effective /Rotate (clockwise display rotation). */
  rotation: 0 | 90 | 180 | 270;
  /** Reader point (x right, y DOWN from the visible top-left) → user space. */
  toUser: (x: number, yDown: number) => { x: number; y: number };
};

/**
 * Describe the visible box (CropBox ∩ MediaBox) of a page in reader space.
 * /Rotate turns the page clockwise for display, so a reader vector maps to
 * user space by rotating it counter-clockwise by the same angle, starting
 * from the user-space corner that ends up bottom-left on screen.
 */
export function readerFrame(page: PDFPage): ReaderFrame {
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  let x0 = Math.max(crop.x, media.x);
  let y0 = Math.max(crop.y, media.y);
  let x1 = Math.min(crop.x + crop.width, media.x + media.width);
  let y1 = Math.min(crop.y + crop.height, media.y + media.height);
  if (x1 <= x0 || y1 <= y0) {
    x0 = media.x;
    y0 = media.y;
    x1 = media.x + media.width;
    y1 = media.y + media.height;
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const rotation = normalizeQuarterTurn(page.getRotation().angle);
  const quarter = rotation % 180 !== 0;
  const width = quarter ? h : w;
  const height = quarter ? w : h;
  const origin =
    rotation === 0
      ? { x: x0, y: y0 }
      : rotation === 90
        ? { x: x1, y: y0 }
        : rotation === 180
          ? { x: x1, y: y1 }
          : { x: x0, y: y1 };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return {
    width,
    height,
    rotation,
    toUser: (x, yDown) => {
      const b = height - yDown; // reader y-up
      return { x: origin.x + x * cos - b * sin, y: origin.y + x * sin + b * cos };
    },
  };
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
  const n = Number.parseInt(full || "000000", 16) || 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const STANDARD: Record<StandardFontFamily, { r: StandardFonts; b: StandardFonts }> = {
  Helvetica: { r: StandardFonts.Helvetica, b: StandardFonts.HelveticaBold },
  Times: { r: StandardFonts.TimesRoman, b: StandardFonts.TimesRomanBold },
  Courier: { r: StandardFonts.Courier, b: StandardFonts.CourierBold },
};

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.split(",")[1] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Stamp every output page of `pdfDoc` in place. Page numbers and Bates numbers
 * follow output position (the doc's current page order). Fonts and the
 * watermark image are embedded once and shared by every page.
 */
export async function applyPageStamps(
  pdfDoc: PDFDocument,
  stamps: PageStamps | null | undefined,
  ctx: PageStampExportContext,
): Promise<void> {
  if (!stamps || !hasPageStamps(stamps)) return;
  const pages = pdfDoc.getPages();
  const total = pages.length;
  const date = ctx.date ?? new Date();

  const fonts = new Map<string, { font: PDFFont; charset: Set<number> }>();
  async function getFont(family: StandardFontFamily, bold: boolean) {
    const key = `${family}-${bold ? "b" : "r"}`;
    let entry = fonts.get(key);
    if (!entry) {
      const std = STANDARD[family] ?? STANDARD.Helvetica;
      const font = await pdfDoc.embedFont(bold ? std.b : std.r);
      entry = { font, charset: new Set(font.getCharacterSet()) };
      fonts.set(key, entry);
    }
    return entry;
  }
  /** Standard fonts are WinAnsi-only; swap anything they can't encode for "?"
   * rather than failing the whole export. */
  const encodable = (text: string, charset: Set<number>) =>
    Array.from(toStandardFontText(text))
      .map((ch) => (charset.has(ch.codePointAt(0) ?? 0) ? ch : "?"))
      .join("");

  const hf = stamps.headerFooter;
  const hfInRange = hf ? makeRangeTest(hf.pageRange, hf.customRange, total) : null;
  const wm = stamps.watermark;
  const wmInRange = wm ? makeRangeTest(wm.pageRange, wm.customRange, total) : null;

  let wmImage: PDFImage | null = null;
  if (wm?.source === "image" && wm.imageDataUrl) {
    const bytes = dataUrlToBytes(wm.imageDataUrl);
    wmImage = wm.imageDataUrl.startsWith("data:image/png")
      ? await pdfDoc.embedPng(bytes)
      : await pdfDoc.embedJpg(bytes);
  }

  for (let outIdx = 0; outIdx < total; outIdx++) {
    const page = pages[outIdx];
    const frame = readerFrame(page);

    if (hf && hfInRange) {
      const items = layoutHeaderFooter(
        hf,
        { outIdx, total, date, fileName: ctx.fileName },
        frame,
        hfInRange,
      );
      if (items.length) {
        const { font, charset } = await getFont(hf.font, false);
        const color = hexToRgb(hf.color);
        for (const item of items) {
          const text = encodable(item.text, charset);
          const w = font.widthOfTextAtSize(text, hf.fontSize);
          const left =
            item.anchor === "start" ? item.x : item.anchor === "end" ? item.x - w : item.x - w / 2;
          const at = frame.toUser(left, item.y);
          page.drawText(text, {
            x: at.x,
            y: at.y,
            size: hf.fontSize,
            font,
            color,
            rotate: degrees(frame.rotation),
          });
        }
      }
    }

    if (wm && wmInRange?.(outIdx)) {
      await drawWatermark(page, frame, wm, wmImage, getFont, encodable);
    }
  }
}

async function drawWatermark(
  page: PDFPage,
  frame: ReaderFrame,
  wm: NonNullable<PageStamps["watermark"]>,
  image: PDFImage | null,
  getFont: (
    f: StandardFontFamily,
    bold: boolean,
  ) => Promise<{ font: PDFFont; charset: Set<number> }>,
  encodable: (text: string, charset: Set<number>) => string,
) {
  const theta = (wm.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const cx = frame.width / 2;
  const cyUp = frame.height / 2;
  const opacity = Math.min(1, Math.max(0, wm.opacity));
  const rotate = degrees(frame.rotation + wm.rotation);

  // Place the stamp's local origin so its centre lands on the page centre after
  // rotating by θ: origin = centre − R(θ)·(local centre). Reader y-up here.
  const originFor = (localCx: number, localCy: number) => {
    const a = cx - (cos * localCx - sin * localCy);
    const b = cyUp - (sin * localCx + cos * localCy);
    return frame.toUser(a, frame.height - b);
  };

  if (wm.source === "image") {
    if (!image) return;
    const size = fitWatermarkImage(image.width, image.height, frame, wm.imageScale);
    const at = originFor(size.width / 2, size.height / 2);
    page.drawImage(image, {
      x: at.x,
      y: at.y,
      width: size.width,
      height: size.height,
      rotate,
      opacity,
    });
    return;
  }

  if (!wm.text.trim()) return;
  const { font, charset } = await getFont(wm.font, wm.bold);
  const text = encodable(wm.text, charset);
  const w = font.widthOfTextAtSize(text, wm.fontSize);
  const at = originFor(w / 2, watermarkMidOffset(wm.font, wm.fontSize));
  page.drawText(text, {
    x: at.x,
    y: at.y,
    size: wm.fontSize,
    font,
    color: hexToRgb(wm.color),
    opacity,
    rotate,
  });
}
