import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  THEME_STORAGE_KEY,
  initialTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from "./theme";

afterEach(() => vi.unstubAllGlobals());

function stubStorage(data: Record<string, string> = {}) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  });
  return data;
}

test("isTheme only accepts the two themes", () => {
  expect(isTheme("light")).toBe(true);
  expect(isTheme("dark")).toBe(true);
  expect(isTheme("system")).toBe(false);
  expect(isTheme(null)).toBe(false);
});

test("a saved choice beats the OS preference", () => {
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

test("without a saved choice (or with garbage) the OS preference decides", () => {
  expect(resolveTheme(null, true)).toBe("dark");
  expect(resolveTheme(null, false)).toBe("light");
  expect(resolveTheme("purple", true)).toBe("dark");
});

test("storeTheme round-trips through storage", () => {
  const data = stubStorage();
  storeTheme("dark");
  expect(data[THEME_STORAGE_KEY]).toBe("dark");
  expect(readStoredTheme()).toBe("dark");
});

test("storage that throws is treated as empty", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  expect(readStoredTheme()).toBeNull();
  expect(() => storeTheme("dark")).not.toThrow();
});

test("initialTheme combines storage and the media query", () => {
  stubStorage({});
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(initialTheme()).toBe("dark");
  stubStorage({ [THEME_STORAGE_KEY]: "light" });
  expect(initialTheme()).toBe("light");
});
