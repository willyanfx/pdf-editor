import { expect, test } from "vite-plus/test";
import { groupIntoLines, type RawItem } from "./textLayer";
import {
  blankRedactedTextEdits,
  blockCharBoundaries,
  excludeRedactedTextEdits,
  hitsText,
  rectForBlockRange,
  textRectsUnderDrag,
} from "./redactGeometry";
import type { RedactEdit, TextEdit } from "../store/useEditorStore";

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

function textEdit(over: Partial<TextEdit>): TextEdit {
  return {
    id: "t",
    type: "text",
    pageIndex: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    runs: [{ text: "hello" }],
    fontSize: 12,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
    color: "#000",
    align: "left",
    origin: "added",
    coverColor: "#fff",
    ...over,
  };
}

const mark = (over: Partial<RedactEdit>): RedactEdit => ({
  id: "r",
  type: "redact",
  pageIndex: 0,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...over,
});

// One line "Hello world" made of two runs 10px apart: "Hello" at x=10 (50 wide)
// and "world" at x=70 (50 wide). The grouper inserts a space between them.
const line = groupIntoLines([raw("Hello", 10, 100, 50), raw("world", 70, 100, 50)])[0];

test("blockCharBoundaries maps run geometry and the inserted gap space", () => {
  expect(line.str).toBe("Hello world");
  const b = blockCharBoundaries(line);
  expect(b).toHaveLength(line.str.length + 1);
  expect(b[0]).toBe(10); // H
  expect(b[5]).toBe(60); // inserted space starts at end of "Hello"
  expect(b[6]).toBe(70); // "w" starts at the second run
  expect(b[11]).toBe(120); // end of "world"
  expect(b[8]).toBeCloseTo(90); // "r" = 2 chars into a 5-char 50px run
});

test("rectForBlockRange covers the character span at full line height with padding", () => {
  const r = rectForBlockRange(line, 6, 11, 2);
  expect(r.x).toBe(68);
  expect(r.width).toBe(54);
  expect(r.y).toBe(line.y - 2);
  expect(r.height).toBe(line.height + 4);
});

test("textRectsUnderDrag snaps a partial drag outward to whole words", () => {
  // Drag from the middle of "Hello" to the middle of "world".
  const rects = textRectsUnderDrag({ x: 30, y: 92, width: 60, height: 10 }, [line], [], 0);
  expect(rects).toHaveLength(1);
  expect(rects[0].x).toBe(10);
  expect(rects[0].x + rects[0].width).toBe(120);
});

test("textRectsUnderDrag covers only the word under a narrow drag", () => {
  const rects = textRectsUnderDrag({ x: 80, y: 92, width: 5, height: 10 }, [line], [], 0);
  expect(rects).toHaveLength(1);
  expect(rects[0].x).toBe(70);
  expect(rects[0].width).toBe(50);
});

test("textRectsUnderDrag ignores a line the drag merely grazes", () => {
  // Line box spans y 90..102; a drag overlapping only 2px of it is ignored.
  const rects = textRectsUnderDrag({ x: 0, y: 100, width: 200, height: 30 }, [line], [], 0);
  expect(rects).toHaveLength(0);
});

test("textRectsUnderDrag marks whole text overlays (box plus cover rect)", () => {
  const overlay = textEdit({
    x: 200,
    y: 50,
    width: 80,
    height: 20,
    origin: "existing",
    coverRect: { x: 198, y: 48, width: 84, height: 24 },
  });
  const rects = textRectsUnderDrag({ x: 210, y: 55, width: 10, height: 10 }, [], [overlay], 0);
  expect(rects).toEqual([{ x: 198, y: 48, width: 84, height: 24 }]);
});

test("hitsText detects points on PDF text and on overlays", () => {
  expect(hitsText({ x: 15, y: 95 }, [line], [])).toBe(true);
  expect(hitsText({ x: 500, y: 500 }, [line], [])).toBe(false);
  expect(hitsText({ x: 5, y: 5 }, [], [textEdit({})])).toBe(true);
});

test("excludeRedactedTextEdits drops overlays touched by a mark on the same page", () => {
  const touched = textEdit({ id: "a", x: 0, y: 0 });
  const elsewhere = textEdit({ id: "b", x: 300, y: 300 });
  const otherPage = textEdit({ id: "c", pageIndex: 1 });
  const m = mark({ x: 50, y: 5, width: 20, height: 5 });
  const kept = excludeRedactedTextEdits([touched, elsewhere, otherPage, m]).map((e) => e.id);
  expect(kept).toEqual(["b", "c", "r"]);
});

test("blankRedactedTextEdits empties the text of touched overlays but keeps their cover", () => {
  const touched = textEdit({
    id: "a",
    origin: "existing",
    coverRect: { x: 0, y: 0, width: 100, height: 20 },
  });
  const m = mark({ x: 10, y: 10, width: 5, height: 5 });
  const out = blankRedactedTextEdits([touched, m]);
  const blanked = out[0] as TextEdit;
  expect(blanked.runs).toEqual([{ text: "" }]);
  expect(blanked.coverRect).toEqual(touched.coverRect);
  expect(out[1]).toBe(m);
});
