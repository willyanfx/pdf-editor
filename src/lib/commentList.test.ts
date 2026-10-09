import { expect, test } from "vite-plus/test";
import {
  commentAuthors,
  filterComments,
  hasActiveFilters,
  relativeTime,
  sortComments,
} from "./commentList";
import { NO_FILTERS } from "../store/useCommentsUiStore";
import type { AnnotationEdit } from "./annotations";

const mk = (over: Partial<AnnotationEdit> & { id: string }): AnnotationEdit =>
  ({
    type: "highlight",
    pageIndex: 0,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: "#ffe066",
    ...over,
  }) as AnnotationEdit;

const A = mk({
  id: "a",
  pageIndex: 1,
  y: 50,
  author: "Ada",
  createdAt: 300,
  text: "Fix the TYPO here",
});
const B = mk({
  id: "b",
  pageIndex: 0,
  y: 90,
  author: "bob",
  createdAt: 100,
  type: "comment",
  text: "",
  status: "accepted",
});
const C = mk({
  id: "c",
  pageIndex: 0,
  y: 10,
  author: "Cy",
  createdAt: 200,
  type: "stamp",
  label: "APPROVED",
  stamp: "Approved",
  status: "rejected",
  replies: [{ id: "r", author: "Ada", text: "needs sign-off", createdAt: 250 }],
} as never);
const ALL = [A, B, C];

test("filters by type, status, author and page", () => {
  const f = (patch: object) => filterComments(ALL, { ...NO_FILTERS, ...patch }, 0).map((e) => e.id);
  expect(f({})).toEqual(["a", "b", "c"]);
  expect(f({ type: "comment" })).toEqual(["b"]);
  expect(f({ status: "rejected" })).toEqual(["c"]);
  expect(f({ status: "none" })).toEqual(["a"]); // missing status counts as "none"
  expect(f({ author: "Ada" })).toEqual(["a"]);
  expect(f({ page: "current" })).toEqual(["b", "c"]);
});

test("search matches note, author, type, stamp label and replies, case-insensitively", () => {
  const q = (query: string) => filterComments(ALL, { ...NO_FILTERS, query }, 0).map((e) => e.id);
  expect(q("typo")).toEqual(["a"]);
  expect(q("BOB")).toEqual(["b"]);
  expect(q("sticky")).toEqual(["b"]); // type label
  expect(q("approved")).toEqual(["c"]); // stamp label
});

test("search covers replies", () => {
  const ids = filterComments(ALL, { ...NO_FILTERS, query: "sign-off" }, 0).map((e) => e.id);
  expect(ids).toEqual(["c"]);
});

test("filters combine (AND)", () => {
  const ids = filterComments(ALL, { ...NO_FILTERS, author: "Ada", type: "comment" }, 0);
  expect(ids).toEqual([]);
});

test("sorts by page position, then date, author, type, status", () => {
  const s = (sort: Parameters<typeof sortComments>[1]) => sortComments(ALL, sort).map((e) => e.id);
  expect(s("page")).toEqual(["c", "b", "a"]); // page 0 y10, page 0 y90, page 1
  expect(s("newest")).toEqual(["a", "c", "b"]);
  expect(s("oldest")).toEqual(["b", "c", "a"]);
  expect(s("author")).toEqual(["a", "b", "c"]); // Ada, bob, Cy (case-insensitive)
  expect(s("type")).toEqual(["a", "c", "b"]); // Highlight, Stamp, Sticky note
  expect(s("status")).toEqual(["a", "b", "c"]); // none, accepted, rejected
});

test("sorting does not mutate its input", () => {
  const copy = [...ALL];
  sortComments(ALL, "newest");
  expect(ALL).toEqual(copy);
});

test("authors are distinct and alphabetical", () => {
  expect(commentAuthors([...ALL, mk({ id: "d", author: "Ada" }), mk({ id: "e" })])).toEqual([
    "Ada",
    "bob",
    "Cy",
  ]);
});

test("hasActiveFilters", () => {
  expect(hasActiveFilters(NO_FILTERS)).toBe(false);
  expect(hasActiveFilters({ ...NO_FILTERS, query: "  " })).toBe(false);
  expect(hasActiveFilters({ ...NO_FILTERS, page: "current" })).toBe(true);
});

test("relativeTime is compact", () => {
  const now = Date.UTC(2026, 5, 10, 12);
  expect(relativeTime(undefined, now)).toBe("");
  expect(relativeTime(now - 10_000, now)).toBe("just now");
  expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
  expect(relativeTime(now - 3 * 3600_000, now)).toBe("3 h ago");
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 d ago");
});
