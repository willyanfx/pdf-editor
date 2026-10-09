/**
 * Pure geometry helpers for redaction marks, all in VIEWER_WIDTH screen space.
 * Kept free of pdf-lib / pdf.js so the UI layers can import it cheaply; the
 * heavy apply-on-download pipeline lives in redact.ts.
 */
import type { ScreenRect } from "./pdfGeometry";
import type { ScreenTextItem } from "./textLayer";
import type { PdfEdit, RedactEdit, TextEdit } from "../store/useEditorStore";

/** Padding (px) added around a text-snapped mark so glyph edges are covered. */
export const MARK_PAD = 2;

export function rectsIntersect(a: ScreenRect, b: ScreenRect, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

export function unionRect(a: ScreenRect, b: ScreenRect): ScreenRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function hasPendingRedactions(edits: PdfEdit[]): boolean {
  return edits.some((e) => e.type === "redact");
}

export function redactMarks(edits: PdfEdit[], pageIndex?: number): RedactEdit[] {
  return edits.filter(
    (e): e is RedactEdit =>
      e.type === "redact" && (pageIndex === undefined || e.pageIndex === pageIndex),
  );
}

/** The full on-page footprint of a text edit: its box plus (for lifted existing
 * text) the cover rectangle pinned to the original glyphs. */
export function textEditBounds(edit: TextEdit): ScreenRect {
  const box = { x: edit.x, y: edit.y, width: edit.width, height: edit.height };
  return edit.coverRect ? unionRect(box, edit.coverRect) : box;
}

/** True when a redaction mark on the same page touches this text edit. */
export function isTextEditRedacted(edit: TextEdit, marks: RedactEdit[]): boolean {
  const bounds = textEditBounds(edit);
  return marks.some((m) => m.pageIndex === edit.pageIndex && rectsIntersect(m, bounds));
}

/** DOCX export: drop every text edit a mark touches, so no redacted overlay
 * text leaks into the Word file. Whole boxes are dropped (never partial). */
export function excludeRedactedTextEdits(edits: PdfEdit[]): PdfEdit[] {
  const marks = redactMarks(edits);
  if (marks.length === 0) return edits;
  return edits.filter((e) => e.type !== "text" || !isTextEditRedacted(e, marks));
}

/**
 * PDF export: a text edit a mark touches is baked with EMPTY text — its cover
 * rectangle (if any) is still painted, but no replacement text is drawn. The
 * raster pass blacks out the mark itself; blanking the whole edit guarantees
 * that text wrapping past the box (which the mark might not cover) can't carry
 * the redacted words into the output.
 */
export function blankRedactedTextEdits(edits: PdfEdit[]): PdfEdit[] {
  const marks = redactMarks(edits);
  if (marks.length === 0) return edits;
  return edits.map((e) =>
    e.type === "text" && isTextEditRedacted(e, marks) ? { ...e, runs: [{ text: "" }] } : e,
  );
}

/** Width of `text` as typeset for `block`, in any consistent unit. */
export type MeasureText = (text: string, block: ScreenTextItem) => number;

/** Positions of the `text.length` character starts across [x, x + width]:
 * evenly spaced, or weighted by `measure` when given (so narrow letters take
 * less room than wide ones). */
function spreadChars(
  block: ScreenTextItem,
  text: string,
  x: number,
  width: number,
  measure?: MeasureText,
): number[] {
  const n = text.length;
  const total = measure ? measure(text, block) || n || 1 : Math.max(1, n);
  return Array.from(
    { length: n },
    (_, k) => x + (width * (measure ? measure(text.slice(0, k), block) : k)) / total,
  );
}

/**
 * The x position of each character boundary of a text block: `n + 1` values
 * for an `n`-character `str`, so characters [s, e) span `b[s]..b[e]`.
 *
 * Uses the block's sub-runs (each with its own x/width from pdf.js) and falls
 * back to a proportional spread when the block has no run geometry. The
 * grouping in textLayer inserts a single space between runs that are visibly
 * apart; that space is mapped onto the gap between the runs. Within a run (or
 * the whole block) characters are spread evenly unless `measure` supplies real
 * glyph widths.
 */
export function blockCharBoundaries(block: ScreenTextItem, measure?: MeasureText): number[] {
  const n = block.str.length;
  const subs = block.subItems;
  const runs = block.runs;
  const whole = () => [
    ...spreadChars(block, block.str, block.x, block.width, measure),
    block.x + block.width,
  ];
  if (!subs || !runs || subs.length !== runs.length) return whole();
  const out: number[] = [];
  let cursor = block.x;
  for (let i = 0; i < runs.length; i++) {
    const text = runs[i].text;
    const sub = subs[i];
    const lead = text.length - sub.str.length;
    if (lead < 0 || !text.endsWith(sub.str)) return whole();
    for (let k = 0; k < lead; k++) out.push(cursor);
    out.push(...spreadChars(block, sub.str, sub.x, sub.width, measure));
    cursor = sub.x + sub.width;
  }
  out.push(cursor);
  return out.length === n + 1 ? out : whole();
}

/** A mark covering characters [start, end) of a block, full line height, padded. */
export function rectForBlockRange(
  block: ScreenTextItem,
  start: number,
  end: number,
  pad = MARK_PAD,
): ScreenRect {
  const b = blockCharBoundaries(block);
  const s = Math.max(0, Math.min(start, b.length - 1));
  const e = Math.max(s, Math.min(end, b.length - 1));
  const x0 = Math.min(b[s], b[e]);
  const x1 = Math.max(b[s], b[e]);
  return {
    x: x0 - pad,
    y: block.y - pad,
    width: x1 - x0 + 2 * pad,
    height: block.height + 2 * pad,
  };
}

/** Whether the vertical overlap between two rects is substantial — at least
 * half of the shorter one — so a drag that merely grazes a line doesn't mark it. */
function coversLine(drag: ScreenRect, line: ScreenRect): boolean {
  const overlap = Math.min(drag.y + drag.height, line.y + line.height) - Math.max(drag.y, line.y);
  return overlap >= 0.5 * Math.min(line.height, Math.max(drag.height, 1));
}

function pointInRect(p: { x: number; y: number }, r: ScreenRect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Does this point sit on existing PDF text or on a text overlay? Decides
 * whether a drag snaps to text (Acrobat behaviour) or marks a free area. */
export function hitsText(
  p: { x: number; y: number },
  blocks: ScreenTextItem[],
  overlays: TextEdit[],
): boolean {
  return (
    blocks.some((b) => pointInRect(p, b)) || overlays.some((o) => pointInRect(p, textEditBounds(o)))
  );
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/**
 * Snap a drag rectangle to the text it covers. Returns one rect per covered
 * line: for existing PDF text, the covered characters expanded outward to
 * whole words; for text overlays (OCR / added text), the whole overlay box —
 * overlay text is re-laid-out on export, so sub-box precision isn't safe.
 * Empty when the drag covers no text.
 */
export function textRectsUnderDrag(
  drag: ScreenRect,
  blocks: ScreenTextItem[],
  overlays: TextEdit[],
  pad = MARK_PAD,
): ScreenRect[] {
  const out: ScreenRect[] = [];
  const dx0 = drag.x;
  const dx1 = drag.x + drag.width;
  for (const block of blocks) {
    if (!rectsIntersect(drag, block) || !coversLine(drag, block)) continue;
    const b = blockCharBoundaries(block);
    const n = block.str.length;
    if (n === 0) continue;
    // First char whose right edge passes the drag's left edge; last char whose
    // left edge is before the drag's right edge.
    let start = 0;
    while (start < n && b[start + 1] <= dx0) start++;
    let end = n;
    while (end > 0 && b[end - 1] >= dx1) end--;
    if (start >= end) continue;
    // Expand to word boundaries.
    while (start > 0 && !isSpace(block.str[start - 1])) start--;
    while (end < n && !isSpace(block.str[end])) end++;
    // Trim whitespace-only selections.
    if (block.str.slice(start, end).trim() === "") continue;
    out.push(rectForBlockRange(block, start, end, pad));
  }
  for (const overlay of overlays) {
    const bounds = textEditBounds(overlay);
    if (!rectsIntersect(drag, bounds) || !coversLine(drag, bounds)) continue;
    out.push({
      x: bounds.x - pad,
      y: bounds.y - pad,
      width: bounds.width + 2 * pad,
      height: bounds.height + 2 * pad,
    });
  }
  return out;
}
