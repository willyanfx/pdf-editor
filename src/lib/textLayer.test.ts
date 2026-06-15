import { expect, test } from "vite-plus/test";
import { groupIntoLines, type RawItem } from "./textLayer";

function raw(str: string, x: number, baseline: number, width: number, fontSize = 10): RawItem {
  return {
    str,
    x,
    y: baseline - fontSize,
    width,
    height: fontSize * 1.2,
    baseline,
    fontSize,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
  };
}

test("merges adjacent runs sharing a baseline into one block", () => {
  const blocks = groupIntoLines([
    raw("Hello", 10, 100, 30),
    raw("world", 42, 100, 30), // small gap → same block
  ]);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].str).toBe("Hello world");
  expect(blocks[0].runs).toHaveLength(2);
  // union bbox spans both runs
  expect(blocks[0].x).toBe(10);
  expect(blocks[0].width).toBe(62); // 42 + 30 - 10
});

test("splits runs separated by a large horizontal gap (columns)", () => {
  const blocks = groupIntoLines([
    raw("Left", 10, 100, 30, 10),
    raw("Right", 400, 100, 30, 10), // gap >> fontSize*1.5 → separate blocks
  ]);
  expect(blocks).toHaveLength(2);
  expect(blocks.map((b) => b.str)).toEqual(["Left", "Right"]);
});

test("separates different lines by baseline", () => {
  const blocks = groupIntoLines([
    raw("Line one", 10, 100, 50),
    raw("Line two", 10, 120, 50), // baseline 20px away → different line
  ]);
  expect(blocks).toHaveLength(2);
});

test("preserves per-run formatting and exposes subItems", () => {
  const bold = { ...raw("BOLD", 42, 100, 30), bold: true };
  const blocks = groupIntoLines([raw("Hi", 10, 100, 30), bold]);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].runs?.[1].bold).toBe(true);
  expect(blocks[0].subItems).toHaveLength(2);
  expect(blocks[0].subItems?.[1].str).toBe("BOLD");
});
