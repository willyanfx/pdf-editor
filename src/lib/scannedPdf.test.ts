import { test, expect } from "vite-plus/test";
import { looksScanned, TEXT_CHAR_THRESHOLD } from "./scannedPdf";

test("flags a document with almost no sampled text as scanned", () => {
  expect(looksScanned(0, true)).toBe(true);
  expect(looksScanned(TEXT_CHAR_THRESHOLD - 1, true)).toBe(true);
});

test("does not flag a document with real text", () => {
  expect(looksScanned(TEXT_CHAR_THRESHOLD, true)).toBe(false);
  expect(looksScanned(500, true)).toBe(false);
});

test("never flags a document with no pages", () => {
  expect(looksScanned(0, false)).toBe(false);
});
