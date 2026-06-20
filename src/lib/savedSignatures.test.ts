import { test, expect, beforeEach } from "vite-plus/test";
import { addSignature, loadSignatures, removeSignature, MAX_SAVED } from "./savedSignatures";

/** Minimal in-memory localStorage so the lib is testable under the node env. */
function installMockStorage(failOnSet = false) {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (failOnSet) throw new DOMException("quota", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => installMockStorage());

test("starts empty", () => {
  expect(loadSignatures()).toEqual([]);
});

test("adds newest-first and round-trips", () => {
  addSignature("data:a");
  addSignature("data:b");
  expect(loadSignatures().map((s) => s.dataUrl)).toEqual(["data:b", "data:a"]);
});

test("dedupes by moving an existing data URL to the front", () => {
  addSignature("data:a");
  addSignature("data:b");
  addSignature("data:a");
  expect(loadSignatures().map((s) => s.dataUrl)).toEqual(["data:a", "data:b"]);
});

test("caps at MAX_SAVED entries, dropping the oldest", () => {
  for (let i = 0; i < MAX_SAVED + 3; i++) addSignature(`data:${i}`);
  const list = loadSignatures();
  expect(list.length).toBe(MAX_SAVED);
  expect(list[0].dataUrl).toBe(`data:${MAX_SAVED + 2}`);
  expect(list.some((s) => s.dataUrl === "data:0")).toBe(false);
});

test("removes by id", () => {
  addSignature("data:a");
  const [entry] = loadSignatures();
  expect(removeSignature(entry.id)).toEqual([]);
  expect(loadSignatures()).toEqual([]);
});

test("survives a quota-exceeded write without throwing", () => {
  installMockStorage(true);
  expect(() => addSignature("data:big")).not.toThrow();
  expect(loadSignatures()).toEqual([]);
});

test("returns [] when stored value is malformed", () => {
  localStorage.setItem("pdf-editor:saved-signatures", "{not json");
  expect(loadSignatures()).toEqual([]);
});
