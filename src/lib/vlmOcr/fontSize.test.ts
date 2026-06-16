import { describe, it, expect } from "vite-plus/test";
import {
  quadToRect,
  quadDimensions,
  estimateFontSizePx,
  estimateLineCount,
  inferBoldFromSize,
  median,
  LINE_GAP,
  MIN_FONT_PX,
  MAX_FONT_PX,
  BOLD_SIZE_RATIO,
  type QuadBox,
} from "./fontSize";

// A clean axis-aligned single line of body text: 200px wide, 18px tall.
// [TL, TR, BR, BL] clockwise.
const bodyLine: QuadBox = [10, 100, 210, 100, 210, 118, 10, 118];

describe("quadToRect", () => {
  it("computes the axis-aligned bounds of a quad", () => {
    expect(quadToRect(bodyLine)).toEqual({ x: 10, y: 100, width: 200, height: 18 });
  });

  it("handles a rotated quad by taking min/max of all corners", () => {
    // A quad skewed so corners aren't axis-aligned.
    const skew: QuadBox = [10, 100, 210, 110, 208, 130, 8, 120];
    const r = quadToRect(skew);
    expect(r.x).toBe(8);
    expect(r.y).toBe(100);
    expect(r.width).toBe(202);
    expect(r.height).toBe(30);
  });
});

describe("quadDimensions", () => {
  it("returns run length as the long axis and line height as the short axis", () => {
    const { runLength, lineHeight } = quadDimensions(bodyLine);
    expect(runLength).toBeCloseTo(200, 1);
    expect(lineHeight).toBeCloseTo(18, 1);
  });

  it("recovers the visual height of a slightly rotated line, not the AABB height", () => {
    // A 200x18 line rotated a few degrees. The axis-aligned height inflates, but
    // the edge-length line height should stay near 18.
    const rotated: QuadBox = [10, 100, 209, 110, 206, 128, 7, 118];
    const { lineHeight } = quadDimensions(rotated);
    // Edge-based height (~18) is well below the AABB height (28).
    expect(lineHeight).toBeLessThan(24);
    expect(lineHeight).toBeGreaterThan(14);
  });

  it("never returns zero or negative dimensions for a degenerate quad", () => {
    const collapsed: QuadBox = [5, 5, 5, 5, 5, 5, 5, 5];
    const { runLength, lineHeight } = quadDimensions(collapsed);
    expect(runLength).toBeGreaterThan(0);
    expect(lineHeight).toBeGreaterThan(0);
  });
});

describe("estimateFontSizePx", () => {
  it("derives font size from a single-line box via the 1.2 line-gap convention", () => {
    // 18px line height → 18 / 1.2 = 15px font.
    const fs = estimateFontSizePx("Hello world", 18, 18, 200);
    expect(fs).toBeCloseTo(18 / LINE_GAP, 1);
  });

  it("divides by the line count for a wrapped multi-line region", () => {
    // A 3-line paragraph 54px tall (18px per line) → ~15px font, not 45px.
    const text = "This is a long paragraph that wraps onto roughly three lines of text here";
    const fs = estimateFontSizePx(text, 54, 18, 200);
    expect(fs).toBeLessThan(20);
    expect(fs).toBeGreaterThan(10);
  });

  it("respects explicit newlines as a lower bound on line count", () => {
    const fs = estimateFontSizePx("line one\nline two", 36, 18, 200);
    // 2 lines → 18px each → 15px font.
    expect(fs).toBeCloseTo(15, 0);
  });

  it("clamps absurdly small boxes up to MIN_FONT_PX", () => {
    expect(estimateFontSizePx("x", 1, 1, 2)).toBe(MIN_FONT_PX);
  });

  it("clamps absurdly large boxes down to MAX_FONT_PX", () => {
    expect(estimateFontSizePx("BIG", 400, 400, 600)).toBe(MAX_FONT_PX);
  });
});

describe("estimateLineCount", () => {
  it("returns 1 for a short single line", () => {
    expect(estimateLineCount("Short title", 200, 18)).toBe(1);
  });

  it("grows for text too long to fit on one line of the given run length", () => {
    const longText = "x".repeat(400);
    // At ~15px font, ~7.5px/char, a 200px run holds ~26 chars → ~16 lines.
    expect(estimateLineCount(longText, 200, 18)).toBeGreaterThan(5);
  });

  it("honors explicit newlines", () => {
    expect(estimateLineCount("a\nb\nc", 500, 18)).toBeGreaterThanOrEqual(3);
  });
});

describe("inferBoldFromSize", () => {
  it("flags a region notably larger than the page median as bold", () => {
    const med = 15;
    expect(inferBoldFromSize(med * BOLD_SIZE_RATIO, med)).toBe(true);
    expect(inferBoldFromSize(med * (BOLD_SIZE_RATIO + 0.2), med)).toBe(true);
  });

  it("does not flag body-sized text", () => {
    expect(inferBoldFromSize(15, 15)).toBe(false);
    expect(inferBoldFromSize(16, 15)).toBe(false);
  });

  it("returns false when there is no median to compare against", () => {
    expect(inferBoldFromSize(40, 0)).toBe(false);
  });
});

describe("median", () => {
  it("returns 0 for an empty array", () => {
    expect(median([])).toBe(0);
  });
  it("returns the middle value", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 20, 30, 40])).toBe(30);
  });
});

describe("font size range sanity", () => {
  it("keeps MIN < MAX", () => {
    expect(MIN_FONT_PX).toBeLessThan(MAX_FONT_PX);
  });
});
