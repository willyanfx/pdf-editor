import { expect, test } from "vite-plus/test";
import { findMatches, isPlausibleSsn, luhnValid } from "./redactPatterns";

const texts = (s: string, matches: ReturnType<typeof findMatches>) =>
  matches.map((m) => s.slice(m.start, m.end));

test("luhnValid accepts valid card numbers and rejects a transposed digit", () => {
  expect(luhnValid("4111111111111111")).toBe(true);
  expect(luhnValid("5500000000000004")).toBe(true);
  expect(luhnValid("378282246310005")).toBe(true); // 15-digit Amex
  expect(luhnValid("4111111111111112")).toBe(false);
  expect(luhnValid("")).toBe(false);
  expect(luhnValid("12a4")).toBe(false);
});

test("isPlausibleSsn applies SSA issuance rules", () => {
  expect(isPlausibleSsn("123", "45", "6789")).toBe(true);
  expect(isPlausibleSsn("000", "45", "6789")).toBe(false);
  expect(isPlausibleSsn("666", "45", "6789")).toBe(false);
  expect(isPlausibleSsn("900", "45", "6789")).toBe(false);
  expect(isPlausibleSsn("123", "00", "6789")).toBe(false);
  expect(isPlausibleSsn("123", "45", "0000")).toBe(false);
});

test("literal match is case-insensitive with flexible whitespace", () => {
  const s = "Contact John   Smith or JOHN SMITH today";
  const m = findMatches(s, { literal: "john smith" });
  expect(texts(s, m)).toEqual(["John   Smith", "JOHN SMITH"]);
  expect(m.every((x) => x.kind === "literal")).toBe(true);
});

test("whole-word literal does not match inside other words", () => {
  const s = "cat concatenate cat.";
  expect(texts(s, findMatches(s, { literal: "cat" }))).toEqual(["cat", "cat", "cat"]);
  expect(texts(s, findMatches(s, { literal: "cat", wholeWord: true }))).toEqual(["cat", "cat"]);
});

test("empty query yields no matches and regex metacharacters are literal", () => {
  expect(findMatches("anything", {})).toEqual([]);
  expect(findMatches("anything", { literal: "   " })).toEqual([]);
  const s = "price (USD) 1.5";
  expect(texts(s, findMatches(s, { literal: "(USD) 1.5" }))).toEqual(["(USD) 1.5"]);
});

test("email pattern", () => {
  const s = "Mail jane.doe+tag@example.co.uk or bob@localhost now";
  expect(texts(s, findMatches(s, { patterns: ["email"] }))).toEqual(["jane.doe+tag@example.co.uk"]);
});

test("phone pattern matches common formats but not arbitrary digit runs", () => {
  const s = "Call (555) 123-4567, 555.123.4567 or +1 555 123 4567. Ref 12345678901234";
  expect(texts(s, findMatches(s, { patterns: ["phone"] }))).toEqual([
    "(555) 123-4567",
    "555.123.4567",
    "+1 555 123 4567",
  ]);
});

test("ssn pattern requires separators and plausible groups", () => {
  const s = "SSN 123-45-6789, also 123 45 6789, not 000-45-6789, not 123456789";
  expect(texts(s, findMatches(s, { patterns: ["ssn"] }))).toEqual(["123-45-6789", "123 45 6789"]);
});

test("credit card pattern is Luhn-checked and tolerates spaces or dashes", () => {
  const s =
    "Card 4111 1111 1111 1111 and 4111-1111-1111-1112 and 378282246310005 and 1234567890123";
  expect(texts(s, findMatches(s, { patterns: ["creditCard"] }))).toEqual([
    "4111 1111 1111 1111",
    "378282246310005",
  ]);
});

test("date pattern covers ISO, slashed, dotted and spelled-out forms", () => {
  const s =
    "On 2024-01-15, 01/15/2024, 15.01.2024, January 15, 2024 and 15 Jan 2024; v2.3.1 is not";
  expect(texts(s, findMatches(s, { patterns: ["date"] }))).toEqual([
    "2024-01-15",
    "01/15/2024",
    "15.01.2024",
    "January 15, 2024",
    "15 Jan 2024",
  ]);
});

test("overlapping matches from different sources are de-duplicated, earliest wins", () => {
  const s = "id 123-45-6789 end";
  const m = findMatches(s, { literal: "45-6789", patterns: ["ssn"] });
  expect(texts(s, m)).toEqual(["123-45-6789"]);
  expect(m[0].kind).toBe("ssn");
});

test("a card number right after a rejected digit run is still found", () => {
  const s = "Order 12345678 4111 1111 1111 1111";
  expect(texts(s, findMatches(s, { patterns: ["creditCard"] }))).toEqual(["4111 1111 1111 1111"]);
});
