import { expect, test } from "vite-plus/test";
import { normalizeRuns, splitRunsAt, applyFormatToRange, runsLength } from "./richText";

test("normalizeRuns merges adjacent equal-style runs and drops empties", () => {
  const runs = normalizeRuns([
    { text: "Hello " },
    { text: "" },
    { text: "world" },
    { text: "!", bold: true },
  ]);
  expect(runs).toEqual([{ text: "Hello world" }, { text: "!", bold: true }]);
});

test("normalizeRuns never returns an empty array", () => {
  expect(normalizeRuns([])).toEqual([{ text: "" }]);
  expect(normalizeRuns([{ text: "" }])).toEqual([{ text: "" }]);
});

test("splitRunsAt splits a straddling run preserving style", () => {
  const [left, right] = splitRunsAt([{ text: "HelloWorld", bold: true }], 5);
  expect(left).toEqual([{ text: "Hello", bold: true }]);
  expect(right).toEqual([{ text: "World", bold: true }]);
});

test("splitRunsAt at a run boundary keeps runs whole", () => {
  const [left, right] = splitRunsAt([{ text: "ab" }, { text: "cd", italic: true }], 2);
  expect(left).toEqual([{ text: "ab" }]);
  expect(right).toEqual([{ text: "cd", italic: true }]);
});

test("applyFormatToRange bolds only the selected characters", () => {
  // "Hello world" → bold "world" (offset 6..11)
  const runs = applyFormatToRange([{ text: "Hello world" }], 6, 11, { bold: true });
  expect(runs).toEqual([{ text: "Hello " }, { text: "world", bold: true }]);
});

test("applyFormatToRange across an existing run boundary", () => {
  const start = [{ text: "Hello " }, { text: "world", bold: true }];
  // color the middle "lo wo" (offset 3..8)
  const runs = applyFormatToRange(start, 3, 8, { color: "#ff0000" });
  expect(runsLength(runs)).toBe(11);
  expect(runs.map((r) => r.text).join("")).toBe("Hello world");
  // "wo" should retain bold AND gain color
  const colored = runs.filter((r) => r.color === "#ff0000");
  expect(colored.map((r) => r.text).join("")).toBe("lo wo");
});

test("applyFormatToRange with empty range is a no-op (normalized)", () => {
  const runs = applyFormatToRange([{ text: "ab" }, { text: "cd" }], 2, 2, { bold: true });
  expect(runs).toEqual([{ text: "abcd" }]);
});
