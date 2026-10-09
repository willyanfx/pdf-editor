import { describe, expect, it } from "vite-plus/test";
import {
  buildDiffOverlay,
  diffPageText,
  diffPixels,
  diffSequences,
  isVisuallyChanged,
  tokenizeBlocks,
  type RgbaImage,
} from "./compareDiff";
import type { ScreenTextItem } from "./textLayer";

function block(str: string, y = 0, x = 0): ScreenTextItem {
  return {
    id: `b${y}`,
    str,
    x,
    y,
    width: str.length * 8,
    height: 12,
    fontSize: 10,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
  };
}

const words = (s: string) => s.split(" ");

describe("diffSequences", () => {
  it("reports no change for identical input", () => {
    expect(diffSequences(words("a b c"), words("a b c"))).toEqual([
      { kind: "equal", aStart: 0, aEnd: 3, bStart: 0, bEnd: 3 },
    ]);
  });

  it("handles empty sides", () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences([], ["x"])).toEqual([
      { kind: "insert", aStart: 0, aEnd: 0, bStart: 0, bEnd: 1 },
    ]);
    expect(diffSequences(["x"], [])).toEqual([
      { kind: "delete", aStart: 0, aEnd: 1, bStart: 0, bEnd: 0 },
    ]);
  });

  it("emits a replacement as delete then insert", () => {
    const segs = diffSequences(words("the quick fox"), words("the slow fox"));
    expect(segs.map((s) => s.kind)).toEqual(["equal", "delete", "insert", "equal"]);
    expect(segs[1]).toMatchObject({ aStart: 1, aEnd: 2 });
    expect(segs[2]).toMatchObject({ bStart: 1, bEnd: 2 });
  });

  it("finds an insertion in the middle without disturbing the rest", () => {
    const segs = diffSequences(words("a b d e"), words("a b c d e"));
    expect(segs.filter((s) => s.kind !== "equal")).toEqual([
      { kind: "insert", aStart: 2, aEnd: 2, bStart: 2, bEnd: 3 },
    ]);
  });

  it("keeps repeated words aligned", () => {
    const segs = diffSequences(words("a a a b"), words("a a b"));
    const removed = segs.filter((s) => s.kind === "delete");
    expect(removed.reduce((n, s) => n + s.aEnd - s.aStart, 0)).toBe(1);
    expect(segs.some((s) => s.kind === "insert")).toBe(false);
  });

  it("covers both inputs exactly once for a scrambled diff", () => {
    const a = words("one two three four five six seven");
    const b = words("one three two four six five eight");
    const segs = diffSequences(a, b);
    let aCount = 0;
    let bCount = 0;
    for (const s of segs) {
      aCount += s.aEnd - s.aStart;
      bCount += s.bEnd - s.bStart;
    }
    expect(aCount).toBe(a.length);
    expect(bCount).toBe(b.length);
  });

  it("falls back to a wholesale replacement beyond the size cap", () => {
    const a = Array.from({ length: 2500 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 2500 }, (_, i) => `b${i}`);
    expect(diffSequences(a, b).map((s) => s.kind)).toEqual(["delete", "insert"]);
  });
});

describe("tokenizeBlocks", () => {
  it("splits on whitespace, normalises ligatures and flags line starts", () => {
    const t = tokenizeBlocks([block("ﬁnal  report"), block("end", 20)]);
    expect(t.map((w) => w.text)).toEqual(["final", "report", "end"]);
    expect(t.map((w) => w.lineStart)).toEqual([true, false, true]);
    // Offsets index the original string (the ligature is one char).
    expect(t[1]).toMatchObject({ block: 0, start: 6, end: 12 });
  });
});

describe("diffPageText", () => {
  it("counts changed words and places highlights on the right side", () => {
    const a = [block("Total due: 100 USD"), block("Thanks", 20)];
    const b = [block("Total due: 250 USD"), block("Thanks", 20)];
    const d = diffPageText(a, b);
    expect(d.removedWords).toBe(1);
    expect(d.addedWords).toBe(1);
    expect(d.removedRects).toHaveLength(1);
    expect(d.addedRects).toHaveLength(1);
    // "100" starts after "Total due: " (11 chars of 8px each).
    expect(d.removedRects[0].x).toBeGreaterThan(80);
    expect(d.removedRects[0].x).toBeLessThan(100);
    expect(d.inline.filter((w) => w.kind !== "equal").map((w) => w.text)).toEqual(["100", "250"]);
  });

  it("places highlights by measured glyph width when given a measure", () => {
    // Every character is 1 unit except "i", which is nearly nothing.
    const narrowI = (t: string) => t.split("").reduce((w, c) => w + (c === "i" ? 0.1 : 1), 0);
    const a = [block("iiiiiiii 100")];
    const b = [block("iiiiiiii 250")];
    const uniform = diffPageText(a, b).removedRects[0];
    const measured = diffPageText(a, b, narrowI).removedRects[0];
    // With uniform widths the word sits 9 chars in (x ≈ 72); weighted, the eight
    // narrow i's take up under a quarter of that, so it starts far further left.
    expect(measured.x).toBeLessThan(uniform.x - 20);
    expect(measured.x + measured.width).toBeCloseTo(a[0].width + 1, 0);
  });

  it("merges adjacent changed words in a block into one highlight", () => {
    const d = diffPageText([block("keep old words here")], [block("keep here")]);
    expect(d.removedWords).toBe(2);
    expect(d.removedRects).toHaveLength(1);
  });

  it("is empty for identical pages", () => {
    const d = diffPageText([block("same")], [block("same")]);
    expect(d.addedWords + d.removedWords).toBe(0);
    expect(d.removedRects).toEqual([]);
  });
});

function solid(w: number, h: number, v: number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4).fill(v);
  return { width: w, height: h, data };
}

function setPixel(img: RgbaImage, x: number, y: number, v: number) {
  const i = (y * img.width + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
}

describe("diffPixels", () => {
  it("finds no difference between identical images", () => {
    const d = diffPixels(solid(4, 4, 255), solid(4, 4, 255));
    expect(d.changedPixels).toBe(0);
    expect(isVisuallyChanged(d)).toBe(false);
  });

  it("ignores sub-threshold colour noise", () => {
    const a = solid(4, 4, 200);
    const b = solid(4, 4, 210);
    expect(diffPixels(a, b).changedPixels).toBe(0);
  });

  it("marks exactly the pixels that differ", () => {
    const a = solid(4, 4, 255);
    const b = solid(4, 4, 255);
    setPixel(b, 1, 2, 0);
    setPixel(b, 3, 0, 0);
    const d = diffPixels(a, b);
    expect(d.changedPixels).toBe(2);
    expect(d.mask[2 * 4 + 1]).toBe(1);
    expect(d.mask[3]).toBe(1);
    expect(d.ratio).toBeCloseTo(2 / 16);
  });

  it("treats area outside the smaller image as white paper", () => {
    const a = solid(4, 4, 255);
    const b = solid(4, 6, 255); // taller, but the extra rows are blank
    expect(diffPixels(a, b)).toMatchObject({ width: 4, height: 6, changedPixels: 0 });
    const c = solid(4, 6, 255);
    setPixel(c, 0, 5, 0); // ink in the new rows
    expect(diffPixels(a, c).changedPixels).toBe(1);
  });

  it("uses a minimum pixel count before reporting a visual change", () => {
    expect(isVisuallyChanged({ changedPixels: 9 })).toBe(false);
    expect(isVisuallyChanged({ changedPixels: 10 })).toBe(true);
  });
});

describe("buildDiffOverlay", () => {
  it("paints changed pixels red, dilated by one, and fades the rest", () => {
    const a = solid(7, 7, 255);
    const b = solid(7, 7, 255);
    setPixel(b, 3, 3, 0);
    const out = buildDiffOverlay(b, diffPixels(a, b));
    const px = (x: number, y: number) =>
      Array.from(out.slice((y * 7 + x) * 4, (y * 7 + x) * 4 + 3));
    expect(px(3, 3)).toEqual([226, 40, 40]);
    expect(px(4, 4)).toEqual([226, 40, 40]); // dilation
    expect(px(6, 6)).toEqual([255, 255, 255]); // untouched white stays white
  });

  it("fades unchanged ink toward white", () => {
    const b = solid(2, 2, 0);
    const out = buildDiffOverlay(b, diffPixels(b, b));
    expect(out[0]).toBeGreaterThan(170);
    expect(out[0]).toBeLessThan(190);
  });
});
