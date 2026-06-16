import type { PDFPageProxy } from "pdfjs-dist";
import type { FontFamily, TextRun } from "../store/useEditorStore";

/** A single piece of existing PDF text, positioned in *screen* pixels at the
 * viewer's render width, ready to be turned into an editable box. */
export type ScreenTextItem = {
  id: string;
  str: string;
  /** Per-run formatting when this item is a grouped line (Step 4). Absent for
   * single-run items (OCR); callers fall back to a single run from `str`. */
  runs?: TextRun[];
  /** The original ungrouped runs that make up this block, each a standalone
   * single-run item. Lets Alt+click isolate one original run. Present only on
   * grouped blocks. */
  subItems?: ScreenTextItem[];
  /** Top-left corner & size of the text's bounding box, in screen px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Font size in screen px (matches the box height closely). */
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
};

/**
 * Pull the text content out of a pdf.js page and project each run into screen
 * coordinates at `renderWidth` px (the same width <Page width=…> renders at).
 *
 * pdf.js gives each run a transform matrix [a,b,c,d,e,f] in PDF user space
 * (bottom-left origin). We build a viewport at our render scale and use it to
 * map the run's baseline origin (e,f) to viewport space (top-left origin),
 * which is exactly the CSS coordinate system of our overlay.
 */
/** One pdf.js text run projected to screen px, before line grouping. Exported
 * for unit tests of the grouping logic. */
export type RawItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Baseline y in screen px, used to group runs into lines. */
  baseline: number;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
};

/** Baseline-y difference (px) within which two runs count as the same line. */
export const Y_THRESHOLD = 3;
/** Horizontal gap (as a multiple of font size) beyond which adjacent runs on a
 * line are split into separate blocks (e.g. table columns, far-apart labels). */
export const X_GAP_RATIO = 1.5;

export async function extractScreenTextItems(
  page: PDFPageProxy,
  renderWidth: number,
): Promise<ScreenTextItem[]> {
  const unscaled = page.getViewport({ scale: 1 });
  const scale = renderWidth / unscaled.width;
  const viewport = page.getViewport({ scale });

  const content = await page.getTextContent();
  const raw: RawItem[] = [];

  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i];
    // Skip marked-content markers (they have no `str`/`transform`).
    if (!("str" in item) || !("transform" in item)) continue;
    if (item.str.trim() === "") continue;

    const t = item.transform as number[];
    // Glyph height in user space ≈ sqrt(b^2 + d^2); for upright text that's |d|.
    const userFontHeight = Math.hypot(t[1], t[3]) || Math.abs(t[3]);
    const fontSize = userFontHeight * scale;

    // (e, f) is the baseline origin in user space. Map it to viewport space.
    const [vx, vy] = viewport.convertToViewportPoint(t[4], t[5]);

    const width = item.width * scale;
    // Box top sits roughly one cap-height above the baseline.
    const lower = item.fontName.toLowerCase();
    raw.push({
      str: item.str,
      x: vx,
      y: vy - fontSize,
      width: Math.max(width, fontSize * 0.4),
      height: fontSize * 1.2,
      baseline: vy,
      fontSize,
      fontFamily: guessFamily(lower),
      bold: /bold|black|heavy|semibold/.test(lower),
      italic: /italic|oblique/.test(lower),
    });
  }

  return groupIntoLines(raw);
}

/** Group raw runs sharing a baseline into line blocks, then split each line at
 * large horizontal gaps. Each resulting block is one editable unit carrying a
 * `runs` array that preserves per-original-run formatting. */
export function groupIntoLines(items: RawItem[]): ScreenTextItem[] {
  const lines: RawItem[][] = [];
  // Sort by baseline, then x, so same-line runs land adjacently.
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);

  for (const item of sorted) {
    const line = lines.find((g) => Math.abs(g[0].baseline - item.baseline) < Y_THRESHOLD);
    if (line) line.push(item);
    else lines.push([item]);
  }

  const blocks: ScreenTextItem[] = [];
  let id = 0;
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let group: RawItem[] = [];
    const flush = () => {
      if (group.length > 0) {
        blocks.push(blockFromRuns(group, id++));
        group = [];
      }
    };
    for (const item of line) {
      if (group.length > 0) {
        const prev = group[group.length - 1];
        const gap = item.x - (prev.x + prev.width);
        if (gap > item.fontSize * X_GAP_RATIO) flush();
      }
      group.push(item);
    }
    flush();
  }
  return blocks;
}

/** Build one ScreenTextItem (with runs + union bbox) from a row of adjacent runs. */
function blockFromRuns(items: RawItem[], id: number): ScreenTextItem {
  const runs: TextRun[] = items.map((it, idx) => {
    // Insert a single space between runs that have a visible gap and aren't
    // already space-separated, so words don't run together when edited.
    let text = it.str;
    if (idx > 0) {
      const prev = items[idx - 1];
      const gap = it.x - (prev.x + prev.width);
      const needsSpace =
        gap > it.fontSize * 0.15 && !prev.str.endsWith(" ") && !it.str.startsWith(" ");
      if (needsSpace) text = ` ${text}`;
    }
    return {
      text,
      bold: it.bold || undefined,
      italic: it.italic || undefined,
      fontSize: it.fontSize,
      fontFamily: it.fontFamily,
    };
  });

  const minX = Math.min(...items.map((it) => it.x));
  const minY = Math.min(...items.map((it) => it.y));
  const maxX = Math.max(...items.map((it) => it.x + it.width));
  const maxY = Math.max(...items.map((it) => it.y + it.height));
  // Dominant (largest) font size drives the box's default size.
  const fontSize = Math.max(...items.map((it) => it.fontSize));
  const first = items[0];
  // A line is "bold"/"italic" only if every non-blank run is — using just the
  // first run misclassifies a heading whose first run is a leading number/space.
  const inkRuns = items.filter((it) => it.str.trim().length > 0);
  const blockBold = inkRuns.length > 0 && inkRuns.every((it) => it.bold);
  const blockItalic = inkRuns.length > 0 && inkRuns.every((it) => it.italic);

  // Each original run as a standalone item, for Alt+click single-run lift.
  const subItems: ScreenTextItem[] = items.map((it, idx) => ({
    id: `txt-${id}-${idx}`,
    str: it.str,
    x: it.x,
    y: it.y,
    width: it.width,
    height: it.height,
    fontSize: it.fontSize,
    fontFamily: it.fontFamily,
    bold: it.bold,
    italic: it.italic,
  }));

  return {
    id: `txt-${id}`,
    str: runs.map((r) => r.text).join(""),
    runs,
    subItems,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    fontSize,
    fontFamily: first.fontFamily,
    bold: blockBold,
    italic: blockItalic,
  };
}

function guessFamily(fontName: string): FontFamily {
  if (/times|serif|georgia|roman|minion|garamond/.test(fontName)) return "Times";
  if (/courier|mono|consol/.test(fontName)) return "Courier";
  return "Helvetica";
}

/**
 * Sample the dominant background color directly behind a region of the rendered
 * page canvas, so the cover rectangle blends in. Returns a hex string.
 *
 * We sample a thin strip just *above* the text box (where the page background
 * usually shows through) to avoid averaging in the glyphs themselves.
 */
export function sampleBackgroundColor(
  canvas: HTMLCanvasElement,
  screenX: number,
  screenY: number,
  screenWidth: number,
  screenHeight: number,
  renderWidth: number,
): string {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#ffffff";

  // The canvas backing store may be at devicePixelRatio; map screen→canvas px.
  const ratio = canvas.width / renderWidth;
  const sx = Math.max(0, Math.round(screenX * ratio));
  const sampleH = Math.max(1, Math.round(Math.min(screenHeight, 6) * ratio));
  // Sample a strip just above the text; clamp into the canvas.
  const sy = Math.max(0, Math.round((screenY - 4) * ratio));
  const sw = Math.max(1, Math.round(screenWidth * ratio));
  const sh = Math.min(sampleH, canvas.height - sy);
  if (sw <= 0 || sh <= 0) return "#ffffff";

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(sx, sy, Math.min(sw, canvas.width - sx), sh).data;
  } catch {
    return "#ffffff";
  }

  // Use the median of each channel to resist anti-aliased glyph edges.
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  }
  const median = (arr: number[]) => {
    if (arr.length === 0) return 255;
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  };
  return rgbToHex(median(rs), median(gs), median(bs));
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
