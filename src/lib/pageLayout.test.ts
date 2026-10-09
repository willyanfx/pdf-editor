import { expect, test } from "vite-plus/test";
import {
  buildPageRows,
  firstPageOfRow,
  nearestShownPage,
  rowContentWidth,
  rowHeight,
  rowIndexOfPage,
  stepPage,
  visiblePages,
} from "./pageLayout";

const pages = (n: number) => Array.from({ length: n }, (_, i) => i);

test("single layout is one page per row", () => {
  expect(buildPageRows(pages(3), "single", false)).toEqual([[0], [1], [2]]);
  // The cover option only matters for the two-page view.
  expect(buildPageRows(pages(3), "single", true)).toEqual([[0], [1], [2]]);
});

test("two-page layout pairs pages and leaves an odd last page alone", () => {
  expect(buildPageRows(pages(5), "two", false)).toEqual([
    [0, 1],
    [2, 3],
    [4, null],
  ]);
  expect(buildPageRows(pages(4), "two", false)).toEqual([
    [0, 1],
    [2, 3],
  ]);
});

test("cover mode puts the first page alone on the right", () => {
  expect(buildPageRows(pages(5), "two", true)).toEqual([
    [null, 0],
    [1, 2],
    [3, 4],
  ]);
  expect(buildPageRows(pages(4), "two", true)).toEqual([
    [null, 0],
    [1, 2],
    [3, null],
  ]);
});

test("empty and single-page documents don't break either layout", () => {
  expect(buildPageRows([], "two", true)).toEqual([]);
  expect(buildPageRows([0], "two", false)).toEqual([[0, null]]);
  expect(buildPageRows([0], "two", true)).toEqual([[null, 0]]);
});

test("visiblePages drops pages the organizer removed", () => {
  expect(visiblePages(4, [])).toEqual([0, 1, 2, 3]);
  expect(visiblePages(4, [0, 2, 3])).toEqual([0, 2, 3]);
  // The organizer's order doesn't reorder the stage; only membership matters.
  expect(visiblePages(4, [3, 0])).toEqual([0, 3]);
});

test("deleted pages let their neighbours pair up", () => {
  const rows = buildPageRows(visiblePages(4, [0, 2, 3]), "two", false);
  expect(rows).toEqual([
    [0, 2],
    [3, null],
  ]);
});

test("rowIndexOfPage and firstPageOfRow", () => {
  const rows = buildPageRows(pages(5), "two", true);
  expect(rowIndexOfPage(rows, 0)).toBe(0);
  expect(rowIndexOfPage(rows, 2)).toBe(1);
  expect(rowIndexOfPage(rows, 4)).toBe(2);
  expect(rowIndexOfPage(rows, 9)).toBe(-1);
  expect(firstPageOfRow(rows[0])).toBe(0);
  expect(firstPageOfRow(rows[1])).toBe(1);
  expect(firstPageOfRow(undefined)).toBeNull();
});

test("stepPage moves by row and stops at the ends", () => {
  const rows = buildPageRows(pages(5), "two", false); // [0,1] [2,3] [4,_]
  expect(stepPage(rows, 0, 1)).toBe(2);
  expect(stepPage(rows, 1, 1)).toBe(2); // right page steps to the next row too
  expect(stepPage(rows, 3, 1)).toBe(4);
  expect(stepPage(rows, 4, 1)).toBeNull();
  expect(stepPage(rows, 4, -1)).toBe(2);
  expect(stepPage(rows, 1, -1)).toBeNull();
  expect(stepPage(rows, 99, 1)).toBeNull();
  const single = buildPageRows(pages(3), "single", false);
  expect(stepPage(single, 1, 1)).toBe(2);
  expect(stepPage(single, 1, -1)).toBe(0);
});

test("stepPage from a page that isn't shown goes to the nearest shown one", () => {
  // Page 1 (index 1) was deleted from a four-page document.
  const single = buildPageRows(visiblePages(4, [0, 2, 3]), "single", false);
  expect(stepPage(single, 0, 1)).toBe(2); // stepping over the gap
  expect(stepPage(single, 2, -1)).toBe(0);
  expect(stepPage(single, 1, 1)).toBe(2); // stale selection on the deleted page
  expect(stepPage(single, 1, -1)).toBe(0);
  const two = buildPageRows(visiblePages(6, [0, 1, 4, 5]), "two", false); // [0,1] [4,5]
  expect(stepPage(two, 3, 1)).toBe(4);
  expect(stepPage(two, 3, -1)).toBe(0);
  expect(stepPage(two, 6, 1)).toBeNull();
  expect(stepPage(single, 99, -1)).toBe(3);
});

test("nearestShownPage resolves a hidden page to its closest neighbour", () => {
  const rows = buildPageRows(visiblePages(6, [0, 1, 4, 5]), "two", false);
  expect(nearestShownPage(rows, 1)).toBe(1);
  expect(nearestShownPage(rows, 2)).toBe(1); // tie between 1 and 4 → earlier
  expect(nearestShownPage(rows, 3)).toBe(4);
  expect(nearestShownPage(rows, 9)).toBe(5);
  expect(nearestShownPage([], 2)).toBeNull();
});

test("rowContentWidth and rowHeight", () => {
  expect(rowContentWidth(1, 800, 24)).toBe(800);
  expect(rowContentWidth(2, 800, 24)).toBe(1624);
  const h = (p: number) => [1000, 1200, 900][p];
  expect(rowHeight([0, 1], h)).toBe(1200);
  expect(rowHeight([null, 2], h)).toBe(900);
  expect(rowHeight([null, null], h)).toBe(0);
});
