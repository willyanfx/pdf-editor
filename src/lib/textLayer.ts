import type { PDFPageProxy } from "pdfjs-dist";
import type { FontFamily } from "../store/useEditorStore";

/** A single piece of existing PDF text, positioned in *screen* pixels at the
 * viewer's render width, ready to be turned into an editable box. */
export type ScreenTextItem = {
  id: string;
  str: string;
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
export async function extractScreenTextItems(
  page: PDFPageProxy,
  renderWidth: number,
): Promise<ScreenTextItem[]> {
  const unscaled = page.getViewport({ scale: 1 });
  const scale = renderWidth / unscaled.width;
  const viewport = page.getViewport({ scale });

  const content = await page.getTextContent();
  const items: ScreenTextItem[] = [];

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
    const x = vx;
    const y = vy - fontSize;
    const height = fontSize * 1.2;

    const lower = item.fontName.toLowerCase();
    items.push({
      id: `txt-${i}`,
      str: item.str,
      x,
      y,
      width: Math.max(width, fontSize * 0.4),
      height,
      fontSize,
      fontFamily: guessFamily(lower),
      bold: /bold|black|heavy|semibold/.test(lower),
      italic: /italic|oblique/.test(lower),
    });
  }

  return items;
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
