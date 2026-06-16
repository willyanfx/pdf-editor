/**
 * Font-size estimation from VLM bounding boxes.
 *
 * Florence-2's `<OCR_WITH_REGION>` task returns text regions as *quad boxes*
 * (four corner points), but it carries no font metrics — no point size, no
 * weight, no family. We recover an approximate font size purely from box
 * geometry, the same way the tesseract path does (height = fontSize * LINE_GAP),
 * but with two refinements the flat tesseract mapping lacks:
 *
 *  1. Quad boxes can be rotated/skewed, so the visual line height is the height
 *     of the *minor* axis of the quad, not `y1 - y0` of an axis-aligned bbox.
 *  2. A single region may wrap several visual lines. We estimate the line count
 *     from the box aspect ratio + character count so a tall multi-line block
 *     doesn't yield an absurd font size.
 *
 * Everything here is pure geometry on screen-pixel coordinates, unit-testable
 * without a browser, a model, or a canvas.
 */

/** A Florence-2 quad box: 8 numbers = [x1,y1, x2,y2, x3,y3, x4,y4] (clockwise
 * from top-left), in the *image* pixel space the model was given. */
export type QuadBox = [number, number, number, number, number, number, number, number];

/** An axis-aligned rectangle in screen px. */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The text-height convention shared with the rest of the editor: a glyph box is
 * ~1.2× the font's point size (see `height: fontSize * 1.2` in textLayer.ts and
 * `fontSize: lineHeight / 1.2` in ocr.ts). Inverting it recovers point size from
 * a measured line height.
 */
export const LINE_GAP = 1.2;

/** Quad → its four (x,y) corner points. */
function corners(q: QuadBox): Array<{ x: number; y: number }> {
  return [
    { x: q[0], y: q[1] },
    { x: q[2], y: q[3] },
    { x: q[4], y: q[5] },
    { x: q[6], y: q[7] },
  ];
}

/** Axis-aligned bounding rect of a quad. */
export function quadToRect(q: QuadBox): Rect {
  const pts = corners(q);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The *visual* (un-rotated) width and height of a quad. For a clockwise quad
 * [TL, TR, BR, BL] the top edge (TL→TR) and bottom edge (BL→BR) are the long
 * axis (text run length); the left edge (TL→BL) and right edge (TR→BR) are the
 * short axis (line height). Averaging opposite edges absorbs minor perspective
 * skew from the model. Falls back gracefully on a degenerate/clockwise-reversed
 * quad by also considering the axis-aligned rect.
 */
export function quadDimensions(q: QuadBox): { runLength: number; lineHeight: number } {
  const [tl, tr, br, bl] = corners(q);
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);

  const edgeRun = (top + bottom) / 2;
  const edgeHeight = (left + right) / 2;

  // A malformed quad (all points collapsed, or corners out of order) can make the
  // edge lengths meaningless. Cross-check against the axis-aligned rect: the true
  // line height can never exceed the rect's smaller side by much, so clamp to it.
  const rect = quadToRect(q);
  const rectMinor = Math.min(rect.width, rect.height);
  const rectMajor = Math.max(rect.width, rect.height);

  // line height = the *shorter* visual axis; run length = the longer one.
  const lineHeight = Math.min(edgeRun, edgeHeight);
  const runLength = Math.max(edgeRun, edgeHeight);

  return {
    lineHeight: clampPositive(lineHeight, rectMinor || lineHeight),
    runLength: clampPositive(runLength, rectMajor || runLength),
  };
}

/** Keep a measured dimension positive and not wildly larger than a sane bound. */
function clampPositive(value: number, bound: number): number {
  if (!Number.isFinite(value) || value <= 0) return Math.max(bound, 1);
  // Allow up to 1.5× the rect bound to tolerate skew, but no further (guards a
  // degenerate edge length that overshot).
  return Math.min(value, bound * 1.5 || value);
}

/**
 * Estimate how many visual text lines a region wraps. A region whose height is
 * close to one line height is a single line; a tall region with many characters
 * wrapped several times. We take the larger of two independent estimates so a
 * wide-but-short box (lots of chars, one line) isn't wrongly split:
 *
 *  - geometric: lineHeight-sized bands that fit in the box height.
 *  - textual:   chars ÷ chars-that-fit-on-one-line, where a line holds about
 *               `runLength / avgCharWidth` characters.
 *
 * `avgCharRatio` is the mean glyph advance as a fraction of the font size
 * (~0.5 for proportional Latin text); tune-free for our purposes.
 */
export function estimateLineCount(
  text: string,
  runLength: number,
  lineHeight: number,
  avgCharRatio = 0.5,
): number {
  const charCount = text.replace(/\s+/g, " ").trim().length;
  if (charCount === 0 || lineHeight <= 0) return 1;

  // Explicit newlines from the model are authoritative when present.
  const explicit = text.split("\n").filter((l) => l.trim().length > 0).length;

  const fontFromHeight = lineHeight / LINE_GAP;
  const avgCharWidth = Math.max(1, fontFromHeight * avgCharRatio);
  const charsPerLine = Math.max(1, runLength / avgCharWidth);
  const textualLines = Math.ceil(charCount / charsPerLine);

  // Geometric: how many line-height bands stack in the visual box. We pass the
  // box's longer-vs-shorter axis already separated, so "stacked lines" only
  // makes sense when the box is taller than one line — approximate via runLength
  // being the long axis and lineHeight the short one, so geometric lines ≈ 1
  // for a normal single line and grows only for genuinely tall regions.
  // (Quad dimensions already pick the short axis as lineHeight, so a multi-line
  // block reports a tall short-axis; we recover bands from the original rect in
  // estimateFontSizePx, which is the caller that knows the rect height.)

  return Math.max(1, explicit, textualLines);
}

/**
 * Estimate a font size (in screen px) for one VLM text region.
 *
 * @param text       the recognized text of the region.
 * @param rectHeight the region's axis-aligned height in *screen* px.
 * @param lineHeight the region's visual line height in *screen* px (minor axis
 *                   of the quad, already mapped to screen space).
 * @param runLength  the region's visual run length in *screen* px (major axis).
 */
export function estimateFontSizePx(
  text: string,
  rectHeight: number,
  lineHeight: number,
  runLength: number,
): number {
  // Bands that physically stack in the box: a single-line region has
  // rectHeight ≈ lineHeight; a wrapped region is an integer multiple taller.
  const geometricLines = lineHeight > 0 ? Math.max(1, Math.round(rectHeight / lineHeight)) : 1;
  const textualLines = estimateLineCount(text, runLength, lineHeight);
  const lines = Math.max(geometricLines, textualLines);

  // Per-line height drives the point size, not the whole-block height.
  const perLineHeight = rectHeight / lines;
  const fontSize = perLineHeight / LINE_GAP;

  // Clamp to a sane on-screen range so a stray box never yields a 0.3px or 400px
  // font. At VIEWER_WIDTH=800 real body text lands ~10–22px; headings up to ~48.
  return clamp(fontSize, MIN_FONT_PX, MAX_FONT_PX);
}

export const MIN_FONT_PX = 4;
export const MAX_FONT_PX = 96;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Infer a bold flag from relative font size. Florence-2 gives no weight, and —
 * unlike the tesseract path — we have no greyscale processed canvas to measure
 * ink density against. The cheap, reliable proxy is size: a region markedly
 * larger than the page's median region is almost always a heading. The caller
 * passes the page's median font size (computed across all regions on the page).
 */
export function inferBoldFromSize(fontSizePx: number, medianFontPx: number): boolean {
  if (medianFontPx <= 0) return false;
  return fontSizePx >= medianFontPx * BOLD_SIZE_RATIO;
}

/** A region this much larger than the page median reads as a heading. Mirrors
 * the spirit of BOLD_DENSITY_RATIO in ocr.ts (1.45), tuned a touch higher since
 * size alone is a coarser signal than ink density. */
export const BOLD_SIZE_RATIO = 1.35;

/** Median of a numeric array (0 for empty). */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
