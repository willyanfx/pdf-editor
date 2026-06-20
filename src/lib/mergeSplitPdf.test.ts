import { test, expect } from "vite-plus/test";
import { parsePageRanges, chunkRanges } from "./mergeSplitPdf";

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

test("chunkRanges splits into even groups with a remainder", () => {
  expect(chunkRanges(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
});

test("chunkRanges of size 1 yields one group per page", () => {
  expect(chunkRanges(3, 1)).toEqual([[0], [1], [2]]);
});

test("chunkRanges clamps size below 1 to 1", () => {
  expect(chunkRanges(2, 0)).toEqual([[0], [1]]);
});

test("chunkRanges with size >= pageCount yields a single group", () => {
  expect(chunkRanges(3, 10)).toEqual([[0, 1, 2]]);
});

test("chunkRanges of an empty document yields no groups", () => {
  expect(chunkRanges(0, 3)).toEqual([]);
});
