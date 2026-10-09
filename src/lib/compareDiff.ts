/**
 * Pure diff primitives for "Compare PDFs": a word-level text diff (with the
 * screen rects of every changed word, so the viewer can highlight them) and a
 * pixel-level visual diff. No pdf.js / canvas here — see comparePdf.ts for the
 * rendering side — so everything is unit-testable in plain Node.
 */
import type { ScreenRect } from "./pdfGeometry";
import type { ScreenTextItem } from "./textLayer";

// --- Text -----------------------------------------------------------------

/** One whitespace-delimited word of a page, with where it sits on the page. */
export type WordToken = {
  /** NFKC-normalised, so "ﬁ" ligatures and compatibility forms compare equal. */
  text: string;
  /** Index into the page's text blocks, and the char range within that block. */
  block: number;
  start: number;
  end: number;
  /** First word of its block (a line) — lets the inline view restore line breaks. */
  lineStart: boolean;
};

export function tokenizeBlocks(blocks: ScreenTextItem[]): WordToken[] {
  const out: WordToken[] = [];
  blocks.forEach((block, bi) => {
    let first = true;
    for (const m of block.str.matchAll(/\S+/g)) {
      out.push({
        text: m[0].normalize("NFKC"),
        block: bi,
        start: m.index,
        end: m.index + m[0].length,
        lineStart: first,
      });
      first = false;
    }
  });
  return out;
}

export type DiffKind = "equal" | "delete" | "insert";
/** Half-open ranges into the A and B token arrays. `equal` has both, `delete`
 * only A, `insert` only B. */
export type DiffSegment = {
  kind: DiffKind;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
};

/** Longest-common-subsequence table cap (cells). Beyond it the changed middle
 * of a page is reported as one wholesale replacement instead of a fine diff. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * Diff two word sequences. Strips the common prefix/suffix first (the usual
 * case — most of a page is untouched), then runs an LCS over what is left.
 * Consecutive operations of the same kind are merged; a replacement comes out
 * as a `delete` immediately followed by an `insert`.
 */
export function diffSequences(a: string[], b: string[]): DiffSegment[] {
  const segs: DiffSegment[] = [];
  const push = (kind: DiffKind, aStart: number, aEnd: number, bStart: number, bEnd: number) => {
    if (aEnd <= aStart && bEnd <= bStart) return;
    const last = segs[segs.length - 1];
    if (last && last.kind === kind && last.aEnd === aStart && last.bEnd === bStart) {
      last.aEnd = aEnd;
      last.bEnd = bEnd;
    } else {
      segs.push({ kind, aStart, aEnd, bStart, bEnd });
    }
  };

  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) {
    suf++;
  }
  push("equal", 0, pre, 0, pre);

  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  const aMid = pre;
  const bMid = pre;

  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    // Pure insert/delete, or too big for a fine diff: replace the middle.
    push("delete", aMid, aMid + n, bMid, bMid);
    push("insert", aMid + n, aMid + n, bMid, bMid + m);
  } else {
    // lcs[i][j] = LCS length of a[aMid+i..] and b[bMid+j..]. n * m <= MAX_LCS_CELLS
    // means min(n, m) < 2000, so an LCS length always fits a Uint16.
    const w = m + 1;
    const lcs = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          a[aMid + i] === b[bMid + j]
            ? lcs[(i + 1) * w + j + 1] + 1
            : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[aMid + i] === b[bMid + j]) {
        push("equal", aMid + i, aMid + i + 1, bMid + j, bMid + j + 1);
        i++;
        j++;
      } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
        push("delete", aMid + i, aMid + i + 1, bMid + j, bMid + j);
        i++;
      } else {
        push("insert", aMid + i, aMid + i, bMid + j, bMid + j + 1);
        j++;
      }
    }
  }
  push("equal", a.length - suf, a.length, b.length - suf, b.length);
  return segs;
}

/** One word in the inline (single-column) rendering of a page diff. */
export type InlineWord = { kind: DiffKind; text: string; lineStart: boolean };

export type PageTextDiff = {
  segments: DiffSegment[];
  addedWords: number;
  removedWords: number;
  /** Highlight rects (800px page space): removed words on the original page… */
  removedRects: ScreenRect[];
  /** …and added words on the revised page. */
  addedRects: ScreenRect[];
  inline: InlineWord[];
};

/** Width of `text` as typeset for `block` (any consistent unit). The default
 * treats every character as equal; comparePdf injects canvas `measureText`, which
 * keeps highlights on the right word when letters vary in width ("i" vs "m"). */
export type MeasureText = (text: string, block: ScreenTextItem) => number;
const byLength: MeasureText = (text) => text.length;

/** x position of each character boundary (length n + 1) of a block. Each pdf.js
 * run keeps its measured extent; inside a run, positions follow glyph widths. */
function charBoundaries(block: ScreenTextItem, measure: MeasureText): number[] {
  const spread = (text: string, x: number, width: number): number[] => {
    const total = measure(text, block) || text.length || 1;
    return Array.from(
      { length: text.length },
      (_, k) => x + (width * measure(text.slice(0, k), block)) / total,
    );
  };
  const subs = block.subItems;
  const runs = block.runs;
  const whole = () => [...spread(block.str, block.x, block.width), block.x + block.width];
  if (!subs || !runs || subs.length !== runs.length) return whole();
  const out: number[] = [];
  let cursor = block.x;
  for (let i = 0; i < runs.length; i++) {
    const text = runs[i].text;
    const sub = subs[i];
    const lead = text.length - sub.str.length;
    if (lead < 0 || !text.endsWith(sub.str)) return whole();
    for (let k = 0; k < lead; k++) out.push(cursor); // inserted gap space
    out.push(...spread(sub.str, sub.x, sub.width));
    cursor = sub.x + sub.width;
  }
  out.push(cursor);
  return out.length === block.str.length + 1 ? out : whole();
}

/** Rects for the token range [from, to) — one per run of words sharing a block,
 * so a changed phrase is a single highlight rather than a box per word. */
function rectsForTokens(
  tokens: WordToken[],
  blocks: ScreenTextItem[],
  from: number,
  to: number,
  measure: MeasureText,
): ScreenRect[] {
  const PAD = 1;
  const rects: ScreenRect[] = [];
  let i = from;
  while (i < to) {
    const bi = tokens[i].block;
    let j = i;
    while (j + 1 < to && tokens[j + 1].block === bi) j++;
    const block = blocks[bi];
    const b = charBoundaries(block, measure);
    const x0 = b[Math.min(tokens[i].start, b.length - 1)];
    const x1 = b[Math.min(tokens[j].end, b.length - 1)];
    rects.push({
      x: x0 - PAD,
      y: block.y - PAD,
      width: x1 - x0 + 2 * PAD,
      height: block.height + 2 * PAD,
    });
    i = j + 1;
  }
  return rects;
}

export function diffPageText(
  blocksA: ScreenTextItem[],
  blocksB: ScreenTextItem[],
  measure: MeasureText = byLength,
): PageTextDiff {
  const ta = tokenizeBlocks(blocksA);
  const tb = tokenizeBlocks(blocksB);
  const segments = diffSequences(
    ta.map((t) => t.text),
    tb.map((t) => t.text),
  );

  let addedWords = 0;
  let removedWords = 0;
  const removedRects: ScreenRect[] = [];
  const addedRects: ScreenRect[] = [];
  const inline: InlineWord[] = [];
  // Words come from the revised side for equal text, so line breaks follow the
  // new layout; deletions keep the original's.
  for (const s of segments) {
    if (s.kind === "delete") {
      removedWords += s.aEnd - s.aStart;
      removedRects.push(...rectsForTokens(ta, blocksA, s.aStart, s.aEnd, measure));
      for (let k = s.aStart; k < s.aEnd; k++) {
        inline.push({ kind: "delete", text: ta[k].text, lineStart: ta[k].lineStart });
      }
    } else if (s.kind === "insert") {
      addedWords += s.bEnd - s.bStart;
      addedRects.push(...rectsForTokens(tb, blocksB, s.bStart, s.bEnd, measure));
      for (let k = s.bStart; k < s.bEnd; k++) {
        inline.push({ kind: "insert", text: tb[k].text, lineStart: tb[k].lineStart });
      }
    } else {
      for (let k = s.bStart; k < s.bEnd; k++) {
        inline.push({ kind: "equal", text: tb[k].text, lineStart: tb[k].lineStart });
      }
    }
  }
  return { segments, addedWords, removedWords, removedRects, addedRects, inline };
}

// --- Pixels ---------------------------------------------------------------

/** The slice of `ImageData` the pixel diff needs (so tests can pass plain objects). */
export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

export type PixelDiff = {
  /** Size of the compared area: the union of both images. */
  width: number;
  height: number;
  /** 1 where the pixel differs, row-major, `width * height` long. */
  mask: Uint8Array;
  changedPixels: number;
  /** changedPixels / (width * height). */
  ratio: number;
};

/** Largest per-channel difference (0–255) that still counts as "the same". */
export const DEFAULT_PIXEL_THRESHOLD = 24;

/**
 * Compare two RGBA images over the union of their sizes. Area outside an image
 * counts as white paper, so a page that merely got taller flags only the content
 * that moved or appeared — not its whole margin.
 */
export function diffPixels(
  a: RgbaImage,
  b: RgbaImage,
  threshold = DEFAULT_PIXEL_THRESHOLD,
): PixelDiff {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const mask = new Uint8Array(width * height);
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ia = x < a.width && y < a.height ? (y * a.width + x) * 4 : -1;
      const ib = x < b.width && y < b.height ? (y * b.width + x) * 4 : -1;
      const ar = ia < 0 ? 255 : a.data[ia];
      const ag = ia < 0 ? 255 : a.data[ia + 1];
      const ab = ia < 0 ? 255 : a.data[ia + 2];
      const br = ib < 0 ? 255 : b.data[ib];
      const bg = ib < 0 ? 255 : b.data[ib + 1];
      const bb = ib < 0 ? 255 : b.data[ib + 2];
      if (
        Math.abs(ar - br) > threshold ||
        Math.abs(ag - bg) > threshold ||
        Math.abs(ab - bb) > threshold
      ) {
        mask[y * width + x] = 1;
        changed++;
      }
    }
  }
  return { width, height, mask, changedPixels: changed, ratio: changed / (width * height || 1) };
}

/** Fewer changed pixels than this is anti-aliasing noise, not a real change. */
export const VISUAL_NOISE_PIXELS = 10;

export function isVisuallyChanged(diff: Pick<PixelDiff, "changedPixels">): boolean {
  return diff.changedPixels >= VISUAL_NOISE_PIXELS;
}

/**
 * The "Difference" picture: the revised page faded toward white, with every
 * changed pixel painted solid red (dilated by one pixel so thin strokes read).
 */
export function buildDiffOverlay(revised: RgbaImage, diff: PixelDiff): Uint8ClampedArray {
  const { width, height, mask } = diff;
  const out = new Uint8ClampedArray(width * height * 4);
  const FADE = 0.3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = 255;
      let g = 255;
      let b = 255;
      if (x < revised.width && y < revised.height) {
        const i = (y * revised.width + x) * 4;
        r = revised.data[i];
        g = revised.data[i + 1];
        b = revised.data[i + 2];
      }
      out[o] = 255 - (255 - r) * FADE;
      out[o + 1] = 255 - (255 - g) * FADE;
      out[o + 2] = 255 - (255 - b) * FADE;
      out[o + 3] = 255;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const o = (ny * width + nx) * 4;
          out[o] = 226;
          out[o + 1] = 40;
          out[o + 2] = 40;
        }
      }
    }
  }
  return out;
}
