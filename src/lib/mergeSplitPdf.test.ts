import { test, expect } from "vite-plus/test";
import { parsePageRanges } from "./mergeSplitPdf";

test("parses single pages and ranges into 0-based groups", () => {
  expect(parsePageRanges("1-3, 5, 8-10", 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
});

test("clamps out-of-range pages and ignores junk tokens", () => {
  expect(parsePageRanges("2-99, abc, 0, 4", 5)).toEqual([[1, 2, 3, 4], [3]]);
});

test("normalizes reversed ranges", () => {
  expect(parsePageRanges("3-1", 5)).toEqual([[0, 1, 2]]);
});

test("empty spec yields no groups", () => {
  expect(parsePageRanges("   ", 5)).toEqual([]);
});
