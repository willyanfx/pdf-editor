import { expect, test, vi, beforeEach, afterEach } from "vite-plus/test";
import {
  STANDARD_FAMILIES,
  GOOGLE_FONTS,
  isStandardFont,
  cssFontFamily,
  fetchFontTtf,
  getGoogleFontEntry,
} from "./fonts";

// ---------------------------------------------------------------------------
// isStandardFont
// ---------------------------------------------------------------------------

test("isStandardFont returns true for the three standard families", () => {
  expect(isStandardFont("Helvetica")).toBe(true);
  expect(isStandardFont("Times")).toBe(true);
  expect(isStandardFont("Courier")).toBe(true);
});

test("isStandardFont returns false for a Google Font family", () => {
  expect(isStandardFont("Roboto")).toBe(false);
  expect(isStandardFont("Open Sans")).toBe(false);
  expect(isStandardFont("Poppins")).toBe(false);
});

test("isStandardFont returns false for arbitrary strings", () => {
  expect(isStandardFont("")).toBe(false);
  expect(isStandardFont("Comic Sans")).toBe(false);
});

// ---------------------------------------------------------------------------
// cssFontFamily
// ---------------------------------------------------------------------------

test("cssFontFamily returns correct stack for Helvetica", () => {
  expect(cssFontFamily("Helvetica")).toBe("Helvetica, Arial, sans-serif");
});

test("cssFontFamily returns correct stack for Times", () => {
  expect(cssFontFamily("Times")).toBe('"Times New Roman", Times, serif');
});

test("cssFontFamily returns correct stack for Courier", () => {
  expect(cssFontFamily("Courier")).toBe('"Courier New", Courier, monospace');
});

test("cssFontFamily returns quoted family + category fallback for a sans-serif Google font", () => {
  const result = cssFontFamily("Roboto");
  expect(result).toBe('"Roboto", sans-serif');
});

test("cssFontFamily returns quoted family + serif fallback for a serif Google font", () => {
  const result = cssFontFamily("Merriweather");
  expect(result).toBe('"Merriweather", serif');
});

test("cssFontFamily returns quoted family + monospace fallback for a monospace Google font", () => {
  const result = cssFontFamily("Source Code Pro");
  expect(result).toBe('"Source Code Pro", monospace');
});

test("cssFontFamily returns quoted family + cursive fallback for a handwriting Google font", () => {
  const result = cssFontFamily("Dancing Script");
  expect(result).toBe('"Dancing Script", cursive');
});

test("cssFontFamily returns quoted family + sans-serif fallback for an unknown family", () => {
  const result = cssFontFamily("Unknown Font");
  expect(result).toBe('"Unknown Font", sans-serif');
});

// ---------------------------------------------------------------------------
// GOOGLE_FONTS catalog invariants
// ---------------------------------------------------------------------------

test("catalog has no duplicate family names", () => {
  const names = GOOGLE_FONTS.map((e) => e.family);
  const unique = new Set(names);
  expect(unique.size).toBe(names.length);
});

test("every catalog entry has at least an 'r' variant with a non-empty ttfUrl", () => {
  for (const entry of GOOGLE_FONTS) {
    expect(entry.variants.r, `${entry.family} missing 'r' variant`).toBeDefined();
    expect(
      entry.variants.r!.ttfUrl.length,
      `${entry.family} 'r' variant has empty ttfUrl`,
    ).toBeGreaterThan(0);
  }
});

test("catalog contains the expected well-known families", () => {
  const families = new Set(GOOGLE_FONTS.map((e) => e.family));
  const required = [
    "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
    "Inter", "Merriweather", "Playfair Display", "Source Code Pro",
    "Nunito", "Raleway", "Oswald",
  ];
  for (const name of required) {
    expect(families.has(name), `catalog missing "${name}"`).toBe(true);
  }
});

test("STANDARD_FAMILIES contains the three PDF standard fonts", () => {
  expect(STANDARD_FAMILIES).toEqual(["Helvetica", "Times", "Courier"]);
});

test("getGoogleFontEntry returns entry for a known Google font", () => {
  const entry = getGoogleFontEntry("Lato");
  expect(entry).toBeDefined();
  expect(entry!.family).toBe("Lato");
  expect(entry!.category).toBe("sans-serif");
});

test("getGoogleFontEntry returns undefined for standard fonts", () => {
  expect(getGoogleFontEntry("Helvetica")).toBeUndefined();
  expect(getGoogleFontEntry("Times")).toBeUndefined();
  expect(getGoogleFontEntry("Courier")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// fetchFontTtf — caching
// ---------------------------------------------------------------------------

const DUMMY_URL = "https://example.com/font.ttf";
const DUMMY_BUFFER = new ArrayBuffer(8);

let fetchSpy: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  // Reset module-level cache between tests by replacing fetch with a spy.
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(DUMMY_BUFFER),
  } as unknown as Response);
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test("fetchFontTtf returns the ArrayBuffer from fetch", async () => {
  const result = await fetchFontTtf(DUMMY_URL);
  expect(result).toBe(DUMMY_BUFFER);
});

test("fetchFontTtf calls fetch only once for repeated calls to the same URL", async () => {
  // Use a URL that wasn't cached by any earlier test.
  const url = "https://example.com/cached-font.ttf";
  await fetchFontTtf(url);
  await fetchFontTtf(url);
  await fetchFontTtf(url);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("fetchFontTtf throws on non-ok response", async () => {
  fetchSpy.mockResolvedValueOnce({
    ok: false,
    status: 404,
  } as unknown as Response);
  await expect(fetchFontTtf("https://example.com/missing.ttf")).rejects.toThrow(
    "404",
  );
});
