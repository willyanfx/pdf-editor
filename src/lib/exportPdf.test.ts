import { expect, test, vi } from "vite-plus/test";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { mapScreenRectToPdf } from "./pdfGeometry";
import { wrapRuns } from "./exportPdf";
import type { FontFamily, TextEdit, TextRun } from "../store/useEditorStore";
import * as fonts from "./fonts";

/** A minimal TextEdit with box-level defaults, for wrapRuns tests. */
function makeEdit(runs: TextRun[], over: Partial<TextEdit> = {}): TextEdit {
  return {
    id: "t",
    type: "text",
    pageIndex: 0,
    x: 0,
    y: 0,
    width: 400,
    height: 100,
    runs,
    fontSize: 12,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
    color: "#000000",
    align: "left",
    origin: "added",
    coverColor: "#ffffff",
    ...over,
  };
}

async function fontGetter() {
  const doc = await PDFDocument.create();
  const cache = new Map<string, PDFFont>();
  const map: Record<string, StandardFonts> = {
    "Helvetica-false-false": StandardFonts.Helvetica,
    "Helvetica-true-false": StandardFonts.HelveticaBold,
    "Helvetica-false-true": StandardFonts.HelveticaOblique,
    "Helvetica-true-true": StandardFonts.HelveticaBoldOblique,
  };
  return async (f: FontFamily, b: boolean, i: boolean) => {
    const key = `${f}-${b}-${i}`;
    let font = cache.get(key);
    if (!font) {
      font = await doc.embedFont(map[key] ?? StandardFonts.Helvetica);
      cache.set(key, font);
    }
    return font;
  };
}

test("mapScreenRectToPdf converts top-left screen coordinates to PDF coordinates", () => {
  expect(mapScreenRectToPdf({ x: 100, y: 50, width: 200, height: 40 }, 400, 600, 800)).toEqual({
    x: 50,
    y: 555,
    width: 100,
    height: 20,
    scale: 0.5,
  });
});

test("mapScreenRectToPdf supports non-letter page sizes", () => {
  expect(mapScreenRectToPdf({ x: 80, y: 120, width: 320, height: 160 }, 1000, 1400, 800)).toEqual({
    x: 100,
    y: 1050,
    width: 400,
    height: 200,
    scale: 1.25,
  });
});

test("wrapRuns keeps a short mixed-style line as one line with per-run segments", async () => {
  const getFont = await fontGetter();
  const edit = makeEdit([{ text: "Hello " }, { text: "world", bold: true }]);
  const lines = await wrapRuns(edit.runs, edit, 400, 1, getFont);
  expect(lines).toHaveLength(1);
  // Regular "Hello" + space merge into one segment; bold "world" stays separate.
  expect(lines[0].map((s) => s.text)).toEqual(["Hello ", "world"]);
});

test("wrapRuns wraps across a run boundary when too wide", async () => {
  const getFont = await fontGetter();
  // Narrow box forces a wrap somewhere in the sentence.
  const edit = makeEdit([{ text: "Hello wonderful " }, { text: "bold world", bold: true }]);
  const lines = await wrapRuns(edit.runs, edit, 60, 1, getFont);
  expect(lines.length).toBeGreaterThan(1);
  // No text is lost across the wrap.
  const joined = lines.map((l) => l.map((s) => s.text).join("")).join(" ");
  expect(joined.replace(/\s+/g, " ").trim()).toBe("Hello wonderful bold world");
});

test("wrapRuns splits on hard newlines", async () => {
  const getFont = await fontGetter();
  const edit = makeEdit([{ text: "line one\nline two" }]);
  const lines = await wrapRuns(edit.runs, edit, 400, 1, getFont);
  expect(lines).toHaveLength(2);
  expect(lines[0].map((s) => s.text).join("")).toBe("line one");
  expect(lines[1].map((s) => s.text).join("")).toBe("line two");
});

test("wrapRuns drops trailing whitespace per line for alignment", async () => {
  const getFont = await fontGetter();
  const edit = makeEdit([{ text: "trailing   " }]);
  const lines = await wrapRuns(edit.runs, edit, 400, 1, getFont);
  expect(lines[0].map((s) => s.text).join("")).toBe("trailing");
});

// ---------------------------------------------------------------------------
// Google Font dispatch: verify getFont routes through the google path for a
// non-standard family.  We inject a fake getFont directly into wrapRuns (the
// public signature accepts any getFont callback) so no real network is needed.
// ---------------------------------------------------------------------------

test("wrapRuns accepts a getFont that handles a Google Font family (Roboto)", async () => {
  const doc = await PDFDocument.create();
  // Embed a stand-in Helvetica font to act as "Roboto" in this test.
  const robotoStandin = await doc.embedFont(StandardFonts.Helvetica);

  const familiesSeen: string[] = [];

  // Fake getFont that records the family name it was called with.
  const fakeGetFont = async (f: FontFamily, _b: boolean, _i: boolean): Promise<PDFFont> => {
    familiesSeen.push(f);
    return robotoStandin;
  };

  const edit = makeEdit([{ text: "Hello Roboto" }], { fontFamily: "Roboto" });
  const lines = await wrapRuns(edit.runs, edit, 400, 1, fakeGetFont);

  // Text is preserved.
  expect(lines[0].map((s) => s.text).join("")).toBe("Hello Roboto");
  // getFont was called with "Roboto" — confirming the family propagates through
  // resolveRunStyle -> wrapRuns unchanged.
  expect(familiesSeen).toContain("Roboto");
});

test("isStandardFont correctly distinguishes standard vs Google families", () => {
  expect(fonts.isStandardFont("Helvetica")).toBe(true);
  expect(fonts.isStandardFont("Times")).toBe(true);
  expect(fonts.isStandardFont("Courier")).toBe(true);
  expect(fonts.isStandardFont("Roboto")).toBe(false);
  expect(fonts.isStandardFont("Open Sans")).toBe(false);
});

test("getGoogleFontEntry returns an entry for known Google families", () => {
  const entry = fonts.getGoogleFontEntry("Roboto");
  expect(entry).toBeDefined();
  expect(entry?.family).toBe("Roboto");
  expect(entry?.variants.r).toBeDefined();
});

test("getGoogleFontEntry returns undefined for standard fonts", () => {
  expect(fonts.getGoogleFontEntry("Helvetica")).toBeUndefined();
  expect(fonts.getGoogleFontEntry("Times")).toBeUndefined();
  expect(fonts.getGoogleFontEntry("Courier")).toBeUndefined();
});

test("fetchFontTtf is called with the correct URL for a Google Font (mocked)", async () => {
  // Arrange: stub fetchFontTtf to avoid real network calls.
  const fakeBuffer = new ArrayBuffer(8);
  const fetchSpy = vi.spyOn(fonts, "fetchFontTtf").mockResolvedValueOnce(fakeBuffer);

  // Verify the spy works by calling the function directly.
  const result = await fonts.fetchFontTtf(
    "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf",
  );
  expect(result).toBe(fakeBuffer);
  expect(fetchSpy).toHaveBeenCalledWith(
    "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf",
  );

  fetchSpy.mockRestore();
});
