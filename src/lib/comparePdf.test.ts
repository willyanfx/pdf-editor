import { expect, test } from "vite-plus/test";
import { summarize, type PageComparison } from "./comparePdf";

const page = (over: Partial<PageComparison>): PageComparison => ({
  pageIndex: 0,
  status: "identical",
  textChanged: false,
  visualChanged: false,
  sizeMismatch: false,
  addedWords: 0,
  removedWords: 0,
  ...over,
});

test("summarize totals changed pages and words across the document", () => {
  const s = summarize([
    page({}),
    page({
      pageIndex: 1,
      status: "changed",
      textChanged: true,
      visualChanged: true,
      addedWords: 3,
      removedWords: 1,
    }),
    page({ pageIndex: 2, status: "changed", visualChanged: true }),
    page({ pageIndex: 3, status: "added", textChanged: true, visualChanged: true, addedWords: 10 }),
  ]);
  expect(s).toMatchObject({
    changedPages: 3,
    textChangedPages: 2,
    visualChangedPages: 3,
    addedWords: 13,
    removedWords: 1,
  });
});

test("summarize of identical pages reports no changes", () => {
  expect(summarize([page({}), page({ pageIndex: 1 })]).changedPages).toBe(0);
});
