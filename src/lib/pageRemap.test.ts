import { test, expect, describe } from "vite-plus/test";
import type { PageOp, PdfEdit } from "../store/useEditorStore";
import {
  clickSelection,
  createdPages,
  formatPageRanges,
  moveGroup,
  parsePageList,
  planDuplicate,
  planInsert,
  planReplace,
  remapPageState,
  removePagesFromState,
  type PageIndexedState,
} from "./pageRemap";

const box = (id: string, pageIndex: number): PdfEdit => ({
  id,
  type: "rectangle",
  pageIndex,
  x: 10,
  y: 10,
  width: 50,
  height: 20,
});
const rot = (pageIndex: number, rotation: number): PageOp => ({ pageIndex, rotation });

function state(pageOrder: number[], edits: PdfEdit[] = [], pageOps: PageOp[] = []) {
  return { edits, pageOps, pageOrder } satisfies PageIndexedState;
}

/** Sequential ids so clone assertions are deterministic. */
function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

const byPage = (s: PageIndexedState) =>
  Object.fromEntries(s.edits.map((e) => [e.id, e.pageIndex] as const));

describe("planInsert + remapPageState", () => {
  test("inserting before a page shifts it and everything after", () => {
    const plan = planInsert(3, [0, 1, 2], 1, 2);
    expect(plan.layout).toEqual([
      { kind: "base", index: 0 },
      { kind: "new", index: 0 },
      { kind: "new", index: 1 },
      { kind: "base", index: 1 },
      { kind: "base", index: 2 },
    ]);
    const next = remapPageState(state([0, 1, 2], [box("a", 0), box("b", 1)], [rot(2, 90)]), plan);
    expect(next.pageOrder).toEqual([0, 1, 2, 3, 4]);
    expect(byPage(next)).toEqual({ a: 0, b: 3 });
    expect(next.pageOps).toEqual([rot(4, 90)]);
    expect(createdPages(plan)).toEqual([1, 2]);
  });

  test("inserting into a reordered order lands at the visible slot", () => {
    // Visible: 2, 0, 1. Insert at slot 1 → before original page 0.
    const plan = planInsert(3, [2, 0, 1], 1, 1);
    const next = remapPageState(state([2, 0, 1], [box("a", 0)]), plan);
    // New file: [new, 0, 1, 2] → old 0→1, 1→2, 2→3; new page = 0.
    expect(next.pageOrder).toEqual([3, 0, 1, 2]);
    expect(byPage(next)).toEqual({ a: 1 });
  });

  test("appending after the last visible page keeps hidden pages hidden", () => {
    // Page 1 was deleted (hidden). Append at the end.
    const plan = planInsert(3, [0, 2], 2, 1);
    const next = remapPageState(state([0, 2]), plan);
    expect(next.pageOrder).toEqual([0, 2, 3]);
    expect(plan.layout).toHaveLength(4);
  });
});

describe("planDuplicate + remapPageState", () => {
  test("puts a copy after each selected page and copies its edits and transforms", () => {
    const before = state([0, 1, 2], [box("a", 0), box("b", 1), box("c", 2)], [rot(2, 180)]);
    const plan = planDuplicate(3, before.pageOrder, [2, 0]);
    expect(plan.layout).toEqual([
      { kind: "base", index: 0 },
      { kind: "base", index: 0, clone: true },
      { kind: "base", index: 1 },
      { kind: "base", index: 2 },
      { kind: "base", index: 2, clone: true },
    ]);
    const next = remapPageState(before, plan, ids());
    expect(next.pageOrder).toEqual([0, 1, 2, 3, 4]);
    expect(byPage(next)).toEqual({ a: 0, b: 2, c: 3, "new-1": 1, "new-2": 4 });
    expect(next.pageOps).toEqual([rot(3, 180), rot(4, 180)]);
    expect(createdPages(plan)).toEqual([1, 4]);
  });

  test("copies are deep: changing the copy doesn't touch the original", () => {
    const ink: PdfEdit = {
      id: "ink",
      type: "ink",
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [{ x: 1, y: 1 }],
      color: "#000",
      strokeWidth: 2,
    };
    const next = remapPageState(state([0], [ink]), planDuplicate(1, [0], [0]), ids());
    const copy = next.edits.find((e) => e.id === "new-1");
    expect(copy?.type).toBe("ink");
    if (copy?.type === "ink") copy.points[0].x = 99;
    expect(ink.points[0].x).toBe(1);
  });

  test("follows the visible order when pages are reordered", () => {
    const plan = planDuplicate(3, [2, 0, 1], [2]);
    const next = remapPageState(state([2, 0, 1]), plan);
    // New file: [0, 1, 2, 2'] → visible 2, 2', 0, 1.
    expect(next.pageOrder).toEqual([2, 3, 0, 1]);
  });

  test("ignores selected pages that aren't visible", () => {
    const plan = planDuplicate(3, [0, 2], [1]);
    expect(plan.layout).toHaveLength(3);
    expect(createdPages(plan)).toEqual([]);
  });
});

describe("planReplace + remapPageState", () => {
  test("one-for-one replacement keeps surrounding order and drops replaced edits", () => {
    const before = state(
      [0, 1, 2, 3],
      [box("a", 0), box("b", 1), box("c", 2), box("d", 3)],
      [rot(1, 90), rot(3, 270)],
    );
    const plan = planReplace(4, before.pageOrder, [1, 2], [4, 5]);
    expect(plan.layout).toEqual([
      { kind: "base", index: 0 },
      { kind: "new", index: 4 },
      { kind: "new", index: 5 },
      { kind: "base", index: 3 },
    ]);
    const next = remapPageState(before, plan);
    expect(next.pageOrder).toEqual([0, 1, 2, 3]);
    expect(byPage(next)).toEqual({ a: 0, d: 3 });
    expect(next.pageOps).toEqual([rot(3, 270)]);
    expect(createdPages(plan)).toEqual([1, 2]);
  });

  test("extra replacement pages go after the last selected page", () => {
    const plan = planReplace(3, [0, 1, 2], [1], [0, 1, 2]);
    const next = remapPageState(state([0, 1, 2], [box("c", 2)]), plan);
    expect(next.pageOrder).toEqual([0, 1, 2, 3, 4]);
    expect(byPage(next)).toEqual({ c: 4 });
  });

  test("fewer replacement pages than selected removes the leftovers", () => {
    const plan = planReplace(4, [0, 1, 2, 3], [1, 2], [0]);
    const next = remapPageState(state([0, 1, 2, 3], [box("d", 3)]), plan);
    expect(next.pageOrder).toEqual([0, 1, 2]);
    expect(byPage(next)).toEqual({ d: 2 });
  });

  test("non-contiguous selection in a reordered document replaces in visible order", () => {
    // Visible: 3, 0, 2, 1 — select originals 0 and 1 (visible slots 2 and 4).
    const plan = planReplace(4, [3, 0, 2, 1], [1, 0], [7, 8]);
    // Visible order matches selection order: 0 gets source 7, 1 gets source 8.
    expect(plan.layout).toEqual([
      { kind: "new", index: 7 },
      { kind: "new", index: 8 },
      { kind: "base", index: 2 },
      { kind: "base", index: 3 },
    ]);
    expect(plan.pageOrder).toEqual([3, 0, 2, 1]);
  });

  test("rejects an empty selection or source", () => {
    expect(() => planReplace(2, [0, 1], [], [0])).toThrow();
    expect(() => planReplace(2, [0, 1], [0], [])).toThrow();
  });
});

test("removePagesFromState drops everything keyed to the removed pages", () => {
  const next = removePagesFromState(
    state([0, 1, 2], [box("a", 0), box("b", 1)], [rot(1, 90), rot(2, 90)]),
    [1],
  );
  expect(next.pageOrder).toEqual([0, 2]);
  expect(next.edits.map((e) => e.id)).toEqual(["a"]);
  expect(next.pageOps).toEqual([rot(2, 90)]);
});

describe("selection", () => {
  const order = [3, 0, 2, 1];
  const plain = { toggle: false, range: false };

  test("plain click selects one and sets the anchor", () => {
    expect(clickSelection([0, 2], 0, 1, order, plain)).toEqual({ selected: [1], anchor: 1 });
  });

  test("toggle adds and removes, keeping visible order", () => {
    const mods = { toggle: true, range: false };
    expect(clickSelection([1], 1, 3, order, mods).selected).toEqual([3, 1]);
    expect(clickSelection([3, 1], 1, 3, order, mods).selected).toEqual([1]);
  });

  test("range selects between the anchor and the click in visible order", () => {
    const mods = { toggle: false, range: true };
    expect(clickSelection([0], 0, 1, order, mods)).toEqual({ selected: [0, 2, 1], anchor: 0 });
    expect(clickSelection([1], 1, 3, order, mods).selected).toEqual([3, 0, 2, 1]);
  });

  test("toggle+range adds the range to the existing selection", () => {
    const mods = { toggle: true, range: true };
    expect(clickSelection([3], 2, 1, order, mods).selected).toEqual([3, 2, 1]);
  });

  test("range without an anchor acts like a plain click", () => {
    expect(clickSelection([], null, 2, order, { toggle: false, range: true }).selected).toEqual([
      2,
    ]);
  });

  test("moveGroup moves selected pages together into a gap", () => {
    // Move 1 and 3 to the very start.
    expect(moveGroup([0, 1, 2, 3, 4], [3, 1], 0)).toEqual([1, 3, 0, 2, 4]);
    // To the end.
    expect(moveGroup([0, 1, 2, 3, 4], [0, 2], 5)).toEqual([1, 3, 4, 0, 2]);
    // Into a gap inside the group: stays put relative to neighbours.
    expect(moveGroup([0, 1, 2, 3], [1, 2], 2)).toEqual([0, 1, 2, 3]);
    // Gap after page 3 (index 4) with group [0, 1].
    expect(moveGroup([0, 1, 2, 3, 4], [0, 1], 4)).toEqual([2, 3, 0, 1, 4]);
  });
});

describe("page ranges", () => {
  test("parses singles, ranges and reversed ranges in written order", () => {
    expect(parsePageList("1-3, 5", 10)).toEqual({ pages: [0, 1, 2, 4], error: null });
    expect(parsePageList(" 4 - 2 ,1", 10)).toEqual({ pages: [3, 2, 1, 0], error: null });
  });

  test("reports out-of-range, malformed and empty input", () => {
    expect(parsePageList("0", 3).error).toMatch(/Page 0/);
    expect(parsePageList("2-4", 3).error).toMatch(/pick pages 1 to 3/);
    expect(parsePageList("2", 1).error).toMatch(/only 1 page/);
    expect(parsePageList("1-", 3).error).toMatch(/isn't a page number/);
    expect(parsePageList("abc", 3).error).toMatch(/isn't a page number/);
    expect(parsePageList(" , ", 3).error).toMatch(/at least one/);
  });

  test("formats page numbers as compact sorted ranges", () => {
    expect(formatPageRanges([1, 2, 3, 5])).toBe("1-3,5");
    expect(formatPageRanges([7, 2, 3, 2])).toBe("2-3,7");
    expect(formatPageRanges([4])).toBe("4");
    expect(formatPageRanges([])).toBe("");
  });
});
