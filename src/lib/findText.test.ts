import { expect, test } from "vite-plus/test";
import { buildFindRegExp, textMatches, type FindOptions } from "./findText";

const loose: FindOptions = { caseSensitive: false, wholeWord: false };

test("an empty or blank query matches nothing", () => {
  expect(buildFindRegExp("", loose)).toBeNull();
  expect(buildFindRegExp("   ", loose)).toBeNull();
  expect(textMatches("anything", "", loose)).toBe(false);
});

test("default search is case-insensitive and matches inside words", () => {
  expect(textMatches("Invoice Total", "total", loose)).toBe(true);
  expect(textMatches("Subtotals", "total", loose)).toBe(true);
});

test("case-sensitive search distinguishes case", () => {
  const opts = { ...loose, caseSensitive: true };
  expect(textMatches("Invoice Total", "total", opts)).toBe(false);
  expect(textMatches("Invoice Total", "Total", opts)).toBe(true);
});

test("whole-word search rejects matches inside longer words", () => {
  const opts = { ...loose, wholeWord: true };
  expect(textMatches("a cat sat", "cat", opts)).toBe(true);
  expect(textMatches("concatenate", "cat", opts)).toBe(false);
  expect(textMatches("cat_food", "cat", opts)).toBe(false);
  expect(textMatches("cats", "cat", opts)).toBe(false);
});

test("whole-word treats punctuation and string edges as boundaries", () => {
  const opts = { ...loose, wholeWord: true };
  expect(textMatches("cat.", "cat", opts)).toBe(true);
  expect(textMatches("(cat)", "cat", opts)).toBe(true);
  expect(textMatches("cat", "cat", opts)).toBe(true);
});

test("whole-word works for non-ASCII letters", () => {
  const opts = { ...loose, wholeWord: true };
  expect(textMatches("un café noir", "café", opts)).toBe(true);
  expect(textMatches("cafés", "café", opts)).toBe(false);
});

test("regex metacharacters in the query are literal", () => {
  expect(textMatches("1+1=2", "1+1", loose)).toBe(true);
  expect(textMatches("111", "1+1", loose)).toBe(false);
  expect(textMatches("what?", "what?", loose)).toBe(true);
  expect(textMatches("a.b", "a.b", { ...loose, wholeWord: true })).toBe(true);
  expect(textMatches("axb", "a.b", loose)).toBe(false);
});

test("whole-word queries that start or end with punctuation still anchor", () => {
  const opts = { ...loose, wholeWord: true };
  expect(textMatches("I like C++ a lot", "C++", opts)).toBe(true);
  expect(textMatches("C++11", "C++", opts)).toBe(false); // "1" continues the word
  expect(textMatches("price: $5", "$5", opts)).toBe(true);
});

test("both options combine", () => {
  const opts = { caseSensitive: true, wholeWord: true };
  expect(textMatches("Go Team", "Team", opts)).toBe(true);
  expect(textMatches("Go team", "Team", opts)).toBe(false);
  expect(textMatches("Teams", "Team", opts)).toBe(false);
});
