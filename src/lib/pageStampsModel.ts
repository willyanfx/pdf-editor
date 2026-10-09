/**
 * Document-level page stamps — header/footer (with page numbers and Bates
 * numbers as tokens) and a watermark — as plain, structured-cloneable data plus
 * the pure logic shared by the live preview (PageStampsLayer) and the pdf-lib
 * bake (pageStamps.ts). No pdf-lib import here, so the preview stays off the
 * heavy export chunk.
 *
 * Units: stamp sizes and margins are typographic points (PDF user units), the
 * way Acrobat's dialogs express them, so a "10 pt" footer is the same physical
 * size on every page of a mixed-size document. Stamps carry no stored page
 * positions — they are laid out against each page's visible box at render time
 * — so this doesn't add a second coordinate system for page content; the
 * preview converts points to the 800px viewer space at its boundary.
 *
 * Layout runs in "reader space": the page as the reader sees it (upright,
 * inside the crop), origin top-left, y down, in points.
 */
import type { StandardFontFamily } from "../store/useEditorStore";

export type StampPageRange = "all" | "odd" | "even" | "custom";

export type HeaderFooterSlot =
  | "topLeft"
  | "topCenter"
  | "topRight"
  | "bottomLeft"
  | "bottomCenter"
  | "bottomRight";

export const HEADER_FOOTER_SLOTS: HeaderFooterSlot[] = [
  "topLeft",
  "topCenter",
  "topRight",
  "bottomLeft",
  "bottomCenter",
  "bottomRight",
];

export type StampDateFormat = "iso" | "us" | "eu" | "long";

export type BatesSettings = {
  prefix: string;
  suffix: string;
  /** Number given to the first output page. */
  start: number;
  /** Zero-pad the number to at least this many digits. */
  digits: number;
};

export type HeaderFooterSettings = {
  slots: Record<HeaderFooterSlot, string>;
  font: StandardFontFamily;
  /** Points. */
  fontSize: number;
  color: string;
  /** Distance from each visible page edge, in points. */
  margins: { top: number; bottom: number; left: number; right: number };
  pageRange: StampPageRange;
  /** 1-based output pages, e.g. "1-3, 7, 10-". Used when pageRange is "custom". */
  customRange: string;
  /** What {page} reads on the first output page. */
  startNumber: number;
  dateFormat: StampDateFormat;
  bates: BatesSettings;
};

export type WatermarkSettings = {
  source: "text" | "image";
  text: string;
  /** PNG or JPEG data URL (source "image"). */
  imageDataUrl: string | null;
  /** The image fits inside this fraction of the visible page (0..1]. */
  imageScale: number;
  font: StandardFontFamily;
  bold: boolean;
  /** Points. */
  fontSize: number;
  color: string;
  /** 0..1 */
  opacity: number;
  /** Degrees, counter-clockwise as the reader sees it. 45 = diagonal. */
  rotation: number;
  pageRange: StampPageRange;
  customRange: string;
};

/** Each stamp is independent: null means "not applied". */
export type PageStamps = {
  headerFooter: HeaderFooterSettings | null;
  watermark: WatermarkSettings | null;
};

export const EMPTY_PAGE_STAMPS: PageStamps = { headerFooter: null, watermark: null };

export function defaultHeaderFooter(): HeaderFooterSettings {
  return {
    slots: {
      topLeft: "",
      topCenter: "",
      topRight: "",
      bottomLeft: "",
      bottomCenter: "",
      bottomRight: "",
    },
    font: "Helvetica",
    fontSize: 10,
    color: "#000000",
    margins: { top: 24, bottom: 24, left: 36, right: 36 },
    pageRange: "all",
    customRange: "",
    startNumber: 1,
    dateFormat: "iso",
    bates: { prefix: "", suffix: "", start: 1, digits: 6 },
  };
}

export function defaultWatermark(): WatermarkSettings {
  return {
    source: "text",
    text: "CONFIDENTIAL",
    imageDataUrl: null,
    imageScale: 0.5,
    font: "Helvetica",
    bold: true,
    fontSize: 72,
    color: "#d32f2f",
    opacity: 0.25,
    rotation: 45,
    pageRange: "all",
    customRange: "",
  };
}

/** Quick presets the header/footer dialog offers; each fills one slot. */
export const HEADER_FOOTER_PRESETS: {
  id: string;
  label: string;
  slot: HeaderFooterSlot;
  text: string;
}[] = [
  { id: "page-of", label: "Page 1 of N", slot: "bottomCenter", text: "Page {page} of {total}" },
  { id: "page", label: "Page number only", slot: "bottomRight", text: "{page}" },
  { id: "bates", label: "Bates number", slot: "bottomRight", text: "{bates}" },
  { id: "date", label: "Date", slot: "topRight", text: "{date}" },
  { id: "filename", label: "File name", slot: "topLeft", text: "{filename}" },
];

export const STAMP_TOKENS = ["{page}", "{total}", "{date}", "{filename}", "{bates}"] as const;

// --- Page ranges ----------------------------------------------------------

/**
 * Parse a custom range like "1-3, 7, 10-" against `total` output pages into a
 * set of 0-based output indices. Open ends ("10-", "-3") run to the last/first
 * page; reversed ranges are normalized; out-of-range numbers are dropped and
 * unparseable tokens ignored.
 */
export function parseStampRange(spec: string, total: number): Set<number> {
  const out = new Set<number>();
  for (const raw of spec.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const range = token.match(/^(\d*)\s*-\s*(\d*)$/);
    let a: number;
    let b: number;
    if (range && (range[1] || range[2])) {
      a = range[1] ? Number.parseInt(range[1], 10) : 1;
      b = range[2] ? Number.parseInt(range[2], 10) : total;
    } else if (/^\d+$/.test(token)) {
      a = b = Number.parseInt(token, 10);
    } else {
      continue;
    }
    if (a > b) [a, b] = [b, a];
    for (let p = Math.max(1, a); p <= Math.min(total, b); p++) out.add(p - 1);
  }
  return out;
}

/** Whether the 0-based output page `outIdx` falls in the stamp's range.
 * Odd/even refer to the 1-based page position ("page 1" is odd). */
export function makeRangeTest(
  range: StampPageRange,
  customRange: string,
  total: number,
): (outIdx: number) => boolean {
  if (range === "odd") return (i) => i % 2 === 0;
  if (range === "even") return (i) => i % 2 === 1;
  if (range === "custom") {
    const set = parseStampRange(customRange, total);
    return (i) => set.has(i);
  }
  return () => true;
}

// --- Tokens -----------------------------------------------------------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatStampDate(date: Date, format: StampDateFormat): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const p2 = (n: number) => String(n).padStart(2, "0");
  switch (format) {
    case "us":
      return `${p2(m)}/${p2(d)}/${y}`;
    case "eu":
      return `${p2(d)}/${p2(m)}/${y}`;
    case "long":
      return `${MONTHS[m - 1]} ${d}, ${y}`;
    default:
      return `${y}-${p2(m)}-${p2(d)}`;
  }
}

/** Bates number for the 0-based output page: prefix + zero-padded count + suffix. */
export function formatBates(bates: BatesSettings, outIdx: number): string {
  const n = Math.max(0, Math.floor(bates.start) + outIdx);
  const digits = Math.min(12, Math.max(1, Math.floor(bates.digits) || 1));
  return `${bates.prefix}${String(n).padStart(digits, "0")}${bates.suffix}`;
}

export type StampTokenContext = {
  /** 0-based position in the OUTPUT document (after reorder/delete). */
  outIdx: number;
  /** Output page count. */
  total: number;
  date: Date;
  fileName: string;
};

/** Replace {page} {total} {date} {filename} {bates}; unknown braces are kept. */
export function resolveStampTokens(
  template: string,
  settings: HeaderFooterSettings,
  ctx: StampTokenContext,
): string {
  return template.replace(/\{(page|total|date|filename|bates)\}/gi, (_, name: string) => {
    switch (name.toLowerCase()) {
      case "page":
        return String(Math.floor(settings.startNumber) + ctx.outIdx);
      case "total":
        return String(ctx.total);
      case "date":
        return formatStampDate(ctx.date, settings.dateFormat);
      case "filename":
        return ctx.fileName;
      default:
        return formatBates(settings.bates, ctx.outIdx);
    }
  });
}

// --- Layout -------------------------------------------------------------------

/** AFM ascender/descender (per 1000 em) of the standard fonts — the same values
 * pdf-lib embeds, so the preview baseline matches the export exactly. */
const FONT_METRICS: Record<StandardFontFamily, { ascent: number; descent: number }> = {
  Helvetica: { ascent: 718, descent: -207 },
  Times: { ascent: 683, descent: -217 },
  Courier: { ascent: 629, descent: -157 },
};

export function fontMetrics(font: StandardFontFamily) {
  return FONT_METRICS[font] ?? FONT_METRICS.Helvetica;
}

export type StampTextItem = {
  slot: HeaderFooterSlot;
  text: string;
  /** Anchor point of the baseline, reader space (pt, y down). */
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
};

/**
 * Resolve and position the header/footer for one output page inside a visible
 * box of `width`×`height` points. Top slots hang their ascender from the top
 * margin; bottom slots sit their descender on the bottom margin. Returns [] when
 * the page is outside the stamp's range.
 */
export function layoutHeaderFooter(
  settings: HeaderFooterSettings,
  ctx: StampTokenContext,
  box: { width: number; height: number },
  inRange: (outIdx: number) => boolean,
): StampTextItem[] {
  if (!inRange(ctx.outIdx)) return [];
  const { ascent, descent } = fontMetrics(settings.font);
  const size = settings.fontSize;
  const topBaseline = settings.margins.top + (ascent / 1000) * size;
  const bottomBaseline = box.height - settings.margins.bottom + (descent / 1000) * size;
  const items: StampTextItem[] = [];
  for (const slot of HEADER_FOOTER_SLOTS) {
    const template = settings.slots[slot];
    if (!template || !template.trim()) continue;
    const text = resolveStampTokens(template, settings, ctx);
    const top = slot.startsWith("top");
    const anchor = slot.endsWith("Left") ? "start" : slot.endsWith("Right") ? "end" : "middle";
    const x =
      anchor === "start"
        ? settings.margins.left
        : anchor === "end"
          ? box.width - settings.margins.right
          : box.width / 2;
    items.push({ slot, text, x, y: top ? topBaseline : bottomBaseline, anchor });
  }
  return items;
}

/** Offset (pt, toward the top of the glyphs) from the baseline to the vertical
 * middle of the font's ascender–descender band; centring a watermark on the
 * page centre puts its baseline this far below the centre. */
export function watermarkMidOffset(font: StandardFontFamily, size: number): number {
  const { ascent, descent } = fontMetrics(font);
  return ((ascent + descent) / 2 / 1000) * size;
}

/** Fit an image of natW×natH inside `scale` of the box, preserving aspect. */
export function fitWatermarkImage(
  natW: number,
  natH: number,
  box: { width: number; height: number },
  scale: number,
): { width: number; height: number } {
  const s = Math.min(1, Math.max(0.05, scale));
  const k = Math.min((box.width * s) / natW, (box.height * s) / natH);
  return { width: natW * k, height: natH * k };
}

/** Normalize any angle to 0/90/180/270. */
export function normalizeQuarterTurn(deg: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Code points above Latin-1 that WinAnsiEncoding (the standard fonts' only
 * encoding) still covers. */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function isWinAnsi(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRAS.has(cp);
}

/** What the export will actually print: characters the standard fonts can't
 * encode become "?" (the preview shows the same, so there are no surprises). */
export function toStandardFontText(text: string): string {
  return Array.from(text.replace(/[\r\n\t]+/g, " "))
    .map((ch) => (isWinAnsi(ch.codePointAt(0) ?? 0) ? ch : "?"))
    .join("");
}

/** True when some characters can't be printed with the standard fonts. */
export function hasUnprintableChars(text: string): boolean {
  return toStandardFontText(text) !== text.replace(/[\r\n\t]+/g, " ");
}

/** Whether there's anything to stamp at all. */
export function hasPageStamps(stamps: PageStamps | null | undefined): boolean {
  if (!stamps) return false;
  const hf = stamps.headerFooter;
  const hfOn = !!hf && HEADER_FOOTER_SLOTS.some((s) => hf.slots[s].trim() !== "");
  const wm = stamps.watermark;
  const wmOn = !!wm && (wm.source === "image" ? !!wm.imageDataUrl : wm.text.trim() !== "");
  return hfOn || wmOn;
}
