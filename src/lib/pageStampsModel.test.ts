import { describe, expect, test } from "vite-plus/test";
import {
  defaultHeaderFooter,
  defaultWatermark,
  fitWatermarkImage,
  formatBates,
  formatStampDate,
  hasPageStamps,
  layoutHeaderFooter,
  makeRangeTest,
  parseStampRange,
  resolveStampTokens,
  toStandardFontText,
  type HeaderFooterSettings,
} from "./pageStampsModel";
import { useEditorStore } from "../store/useEditorStore";

const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe("parseStampRange", () => {
  test("lists and ranges, 1-based in, 0-based out", () => {
    expect(sorted(parseStampRange("1-3, 7", 10))).toEqual([0, 1, 2, 6]);
  });
  test("open-ended and reversed ranges", () => {
    expect(sorted(parseStampRange("8-", 10))).toEqual([7, 8, 9]);
    expect(sorted(parseStampRange("-2", 10))).toEqual([0, 1]);
    expect(sorted(parseStampRange("5-3", 10))).toEqual([2, 3, 4]);
  });
  test("drops out-of-range numbers and junk", () => {
    expect(sorted(parseStampRange("0, 11, abc, 2-, ,", 3))).toEqual([1, 2]);
    expect(parseStampRange("", 5).size).toBe(0);
  });
});

test("odd / even / all range tests use 1-based positions", () => {
  const odd = makeRangeTest("odd", "", 5);
  const even = makeRangeTest("even", "", 5);
  expect([0, 1, 2, 3, 4].filter(odd)).toEqual([0, 2, 4]);
  expect([0, 1, 2, 3, 4].filter(even)).toEqual([1, 3]);
  expect([0, 1, 2].filter(makeRangeTest("all", "", 3))).toEqual([0, 1, 2]);
  expect([0, 1, 2, 3].filter(makeRangeTest("custom", "2, 4", 4))).toEqual([1, 3]);
});

describe("tokens", () => {
  const date = new Date(2026, 0, 5);
  const settings = (p: Partial<HeaderFooterSettings> = {}) => ({ ...defaultHeaderFooter(), ...p });

  test("{page} adds the start-number offset to the output position; {total} is the output count", () => {
    const s = settings({ startNumber: 5 });
    const ctx = { outIdx: 2, total: 10, date, fileName: "a.pdf" };
    expect(resolveStampTokens("Page {page} of {total}", s, ctx)).toBe("Page 7 of 10");
  });

  test("{date}, {filename}, case-insensitive, unknown tokens kept", () => {
    const s = settings({ dateFormat: "long" });
    const ctx = { outIdx: 0, total: 1, date, fileName: "brief.pdf" };
    expect(resolveStampTokens("{DATE} · {filename} · {foo}", s, ctx)).toBe(
      "January 5, 2026 · brief.pdf · {foo}",
    );
  });

  test("date formats", () => {
    expect(formatStampDate(date, "iso")).toBe("2026-01-05");
    expect(formatStampDate(date, "us")).toBe("01/05/2026");
    expect(formatStampDate(date, "eu")).toBe("05/01/2026");
  });

  test("{bates} resolves per output page", () => {
    const s = settings({ bates: { prefix: "ABC", suffix: "-X", start: 98, digits: 6 } });
    const at = (outIdx: number) =>
      resolveStampTokens("{bates}", s, { outIdx, total: 5, date, fileName: "" });
    expect([at(0), at(1), at(2)]).toEqual(["ABC000098-X", "ABC000099-X", "ABC000100-X"]);
  });
});

describe("formatBates", () => {
  test("zero-pads to the requested digits", () => {
    expect(formatBates({ prefix: "", suffix: "", start: 7, digits: 4 }, 0)).toBe("0007");
  });
  test("never truncates a number longer than the padding", () => {
    expect(formatBates({ prefix: "P", suffix: "", start: 123456, digits: 3 }, 1)).toBe("P123457");
  });
  test("clamps silly digit counts", () => {
    expect(formatBates({ prefix: "", suffix: "", start: 1, digits: 0 }, 0)).toBe("1");
  });
});

describe("layoutHeaderFooter", () => {
  const box = { width: 600, height: 800 };
  const ctx = { outIdx: 0, total: 3, date: new Date(), fileName: "f.pdf" };
  const s: HeaderFooterSettings = {
    ...defaultHeaderFooter(),
    slots: { ...defaultHeaderFooter().slots, topLeft: "L", topCenter: "C", bottomRight: "{page}" },
  };

  test("anchors each slot to its margin and edge", () => {
    const items = layoutHeaderFooter(s, ctx, box, () => true);
    const by = Object.fromEntries(items.map((i) => [i.slot, i]));
    expect(by.topLeft).toMatchObject({ x: 36, anchor: "start" });
    expect(by.topCenter).toMatchObject({ x: 300, anchor: "middle" });
    expect(by.bottomRight).toMatchObject({ x: 564, anchor: "end", text: "1" });
    // 10pt Helvetica: ascender 0.718em below the 24pt top margin, descender
    // 0.207em above the 24pt bottom margin.
    expect(by.topLeft.y).toBeCloseTo(31.18);
    expect(by.bottomRight.y).toBeCloseTo(800 - 24 - 2.07);
  });

  test("skips empty slots and out-of-range pages", () => {
    expect(layoutHeaderFooter(s, ctx, box, () => true)).toHaveLength(3);
    expect(layoutHeaderFooter(s, ctx, box, () => false)).toEqual([]);
  });
});

test("fitWatermarkImage keeps aspect inside the scaled box", () => {
  expect(fitWatermarkImage(200, 100, { width: 600, height: 800 }, 0.5)).toEqual({
    width: 300,
    height: 150,
  });
  expect(fitWatermarkImage(100, 400, { width: 600, height: 800 }, 0.5)).toEqual({
    width: 100,
    height: 400,
  });
});

test("toStandardFontText swaps what WinAnsi can't encode", () => {
  expect(toStandardFontText("Café – “ok” €5 ✓\nnext")).toBe("Café – “ok” €5 ? next");
});

test("hasPageStamps ignores empty settings", () => {
  expect(hasPageStamps({ headerFooter: defaultHeaderFooter(), watermark: null })).toBe(false);
  expect(
    hasPageStamps({ headerFooter: null, watermark: { ...defaultWatermark(), text: " " } }),
  ).toBe(false);
  expect(hasPageStamps({ headerFooter: null, watermark: defaultWatermark() })).toBe(true);
});

describe("store: page stamps are document state", () => {
  test("set / remove are undoable and setFile resets them", () => {
    const store = useEditorStore;
    store.getState().setFile(new File([new Uint8Array([1])], "a.pdf"));
    const hf = {
      ...defaultHeaderFooter(),
      slots: { ...defaultHeaderFooter().slots, topLeft: "X" },
    };

    store.getState().setHeaderFooter(hf);
    store.getState().setWatermark(defaultWatermark());
    expect(store.getState().pageStamps.headerFooter?.slots.topLeft).toBe("X");
    expect(store.getState().pageStamps.watermark).not.toBeNull();

    // Removing the watermark leaves the header/footer alone.
    store.getState().setWatermark(null);
    expect(store.getState().pageStamps).toMatchObject({ watermark: null });
    expect(store.getState().pageStamps.headerFooter).not.toBeNull();

    store.getState().undo();
    expect(store.getState().pageStamps.watermark).not.toBeNull();
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().pageStamps).toEqual({ headerFooter: null, watermark: null });
    store.getState().redo();
    expect(store.getState().pageStamps.headerFooter?.slots.topLeft).toBe("X");

    // History entries are deep copies — later edits can't leak into them.
    expect(store.getState()._past.at(-1)?.pageStamps).toEqual({
      headerFooter: null,
      watermark: null,
    });

    store.getState().setFile(new File([new Uint8Array([1])], "b.pdf"));
    expect(store.getState().pageStamps).toEqual({ headerFooter: null, watermark: null });
  });
});
