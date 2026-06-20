import { test, expect } from "vite-plus/test";
import { formatBytes, summarizePageSizes } from "./pdfMetadata";

test("formatBytes uses B/KB/MB with sensible precision", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1024)).toBe("1.0 KB");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
});

test("summarizePageSizes reports a single size", () => {
  expect(summarizePageSizes([{ width: 612, height: 792 }])).toBe("612 × 792 pt");
});

test("summarizePageSizes flags mixed sizes", () => {
  expect(
    summarizePageSizes([
      { width: 612, height: 792 },
      { width: 595, height: 842 },
    ]),
  ).toBe("612 × 792 pt (mixed)");
});

test("summarizePageSizes handles an empty document", () => {
  expect(summarizePageSizes([])).toBe("—");
});
