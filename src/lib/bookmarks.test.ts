import { test, expect, beforeEach } from "vite-plus/test";
import { PDFDocument } from "pdf-lib";
import {
  bookmarksForExport,
  insertBookmark,
  makeBookmark,
  mapBookmarkPages,
  moveBookmark,
  moveBookmarkTo,
  removeBookmark,
  resolveBookmarksForOutput,
  topLevelSlotForPage,
  type Bookmark,
} from "./bookmarks";
import { remapIndexAfterInsert } from "./pageInsert";
import { useEditorStore } from "../store/useEditorStore";
import { loadOutlineIntoStore, type OutlineSource } from "./outlineRead";

/** Compact view of a tree: "title" or "title(child, child)". */
function shape(tree: Bookmark[]): string {
  return tree
    .map((b) => (b.children.length ? `${b.title}(${shape(b.children)})` : b.title))
    .join(", ");
}

function bm(title: string, pageIndex: number | null, children: Bookmark[] = []): Bookmark {
  return { id: title, title, pageIndex, children };
}

const sample = () => [bm("A", 0, [bm("A1", 1), bm("A2", 2)]), bm("B", 3), bm("C", 4)];

test("move up/down swaps siblings and is a no-op at the ends", () => {
  expect(shape(moveBookmark(sample(), "B", "up"))).toBe("B, A(A1, A2), C");
  expect(shape(moveBookmark(sample(), "A2", "up"))).toBe("A(A2, A1), B, C");
  const t = sample();
  expect(moveBookmark(t, "A", "up")).toBe(t);
  expect(moveBookmark(t, "C", "down")).toBe(t);
  expect(moveBookmark(t, "A2", "down")).toBe(t);
});

test("indent nests under the previous sibling; outdent moves after the parent", () => {
  expect(shape(moveBookmark(sample(), "B", "indent"))).toBe("A(A1, A2, B), C");
  expect(shape(moveBookmark(sample(), "A2", "indent"))).toBe("A(A1(A2)), B, C");
  expect(shape(moveBookmark(sample(), "A1", "outdent"))).toBe("A(A2), A1, B, C");
  const t = sample();
  expect(moveBookmark(t, "A", "indent")).toBe(t);
  expect(moveBookmark(t, "B", "outdent")).toBe(t);
});

test("drag-and-drop moves before/after/inside, but never into its own subtree", () => {
  expect(shape(moveBookmarkTo(sample(), "C", "A1", "before"))).toBe("A(C, A1, A2), B");
  expect(shape(moveBookmarkTo(sample(), "A", "B", "after"))).toBe("B, A(A1, A2), C");
  expect(shape(moveBookmarkTo(sample(), "B", "C", "inside"))).toBe("A(A1, A2), C(B)");
  const t = sample();
  expect(moveBookmarkTo(t, "A", "A2", "inside")).toBe(t);
  expect(moveBookmarkTo(t, "A", "A", "after")).toBe(t);
});

test("insert after a bookmark or at a top-level slot; remove takes the subtree", () => {
  const n = bm("N", 5);
  expect(shape(insertBookmark(sample(), n, { afterId: "A1" }))).toBe("A(A1, N, A2), B, C");
  expect(shape(insertBookmark(sample(), n, { topLevelIndex: 1 }))).toBe("A(A1, A2), N, B, C");
  expect(shape(insertBookmark(sample(), n, { afterId: "missing" }))).toBe("A(A1, A2), B, C, N");
  expect(shape(removeBookmark(sample(), "A"))).toBe("B, C");
});

test("topLevelSlotForPage keeps a page-ordered outline in page order", () => {
  const pos = (i: number) => [0, 1, 2, 3, 4].indexOf(i);
  expect(topLevelSlotForPage(sample(), 0, pos)).toBe(1);
  expect(topLevelSlotForPage(sample(), 3, pos)).toBe(2);
  expect(topLevelSlotForPage(sample(), 4, pos)).toBe(3);
  expect(topLevelSlotForPage([], 2, pos)).toBe(0);
});

test("resolveBookmarksForOutput prunes deleted pages and promotes children in place", () => {
  // Page 0 deleted; order is [3, 1, 2, 4] → origToOut.
  const origToOut = [-1, 1, 2, 0, 3];
  const out = resolveBookmarksForOutput(
    [...sample(), bm("Link", null, [bm("Under link", 0)])],
    origToOut,
  );
  expect(out.map((b) => [b.title, b.outPage])).toEqual([
    ["A1", 1],
    ["A2", 2],
    ["B", 0],
    ["C", 3],
    ["Link", null],
  ]);
  expect(out[4].children).toEqual([]); // its only child was on the deleted page
});

test("mapBookmarkPages with remapIndexAfterInsert shifts pages at/after the insert point", () => {
  const remapped = mapBookmarkPages(sample(), (i) => remapIndexAfterInsert(i, 2, 3));
  const pages = (t: Bookmark[]): (number | null)[] =>
    t.flatMap((b) => [b.pageIndex, ...pages(b.children)]);
  expect(pages(remapped)).toEqual([0, 1, 5, 6, 7]);
});

test("bookmarksForExport only takes over the outline once it's known", () => {
  const some = [bm("A", 0)];
  expect(bookmarksForExport({ bookmarks: [], outlineStatus: "pending" })).toBeUndefined();
  expect(bookmarksForExport({ bookmarks: [], outlineStatus: "failed" })).toBeUndefined();
  expect(bookmarksForExport({ bookmarks: [], outlineStatus: "ready" })).toEqual([]);
  expect(bookmarksForExport({ bookmarks: some, outlineStatus: "failed" })).toBe(some);
});

// --- Store integration --------------------------------------------------------

async function pdfFile(pageCount: number, name: string): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([300 + i, 400]);
  const bytes = await doc.save();
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

beforeEach(() => {
  useEditorStore.setState({ _past: [], _future: [] });
});

test("loading the outline creates no undo step and ignores a stale file", async () => {
  const first = await pdfFile(3, "first.pdf");
  const second = await pdfFile(3, "second.pdf");
  const store = useEditorStore.getState;
  store().setFile(first);
  store().setNumPages(3);
  // Editing is disabled until the outline has been read.
  store().addBookmark(makeBookmark({ title: "Early", pageIndex: 0 }));
  expect(store().bookmarks).toEqual([]);
  // An unrelated edit made while the outline is still loading…
  store().setPageOrder([2, 1, 0]);

  // A newer file is opened before the first file's outline arrives.
  store().setFile(second);
  store().setNumPages(3);
  store().applyLoadedBookmarks(first, [bm("From first", 0)]);
  expect(store().bookmarks).toEqual([]);
  expect(store().outlineStatus).toBe("pending");

  store().setPageOrder([1, 0, 2]);
  store().applyLoadedBookmarks(second, [bm("From second", 1)]);
  expect(store().outlineStatus).toBe("ready");
  expect(shape(store().bookmarks)).toBe("From second");
  expect(store()._past).toHaveLength(1); // only the reorder
  // Undoing the earlier edit keeps the file's own outline.
  store().undo();
  expect(shape(store().bookmarks)).toBe("From second");
  // A second report (e.g. the viewer reloading after an insert) is ignored.
  store().applyLoadedBookmarks(second, [bm("Again", 0)]);
  expect(shape(store().bookmarks)).toBe("From second");
});

test("loadOutlineIntoStore applies what the viewer's document reports", async () => {
  const file = await pdfFile(3, "doc.pdf");
  useEditorStore.getState().setFile(file);
  const fakePdf = {
    getOutline: async () => [
      {
        title: "Intro\u0000",
        dest: [{ num: 9, gen: 0 }, { name: "XYZ" }, 0, 250, null],
        items: [],
      },
      { title: "Docs", dest: null, url: "https://example.com", items: [] },
    ],
    getDestination: async () => null,
    getPageIndex: async () => 2,
  } as unknown as OutlineSource;
  await loadOutlineIntoStore(fakePdf, file);
  const [intro, docs] = useEditorStore.getState().bookmarks;
  expect([intro.title, intro.pageIndex, intro.top]).toEqual(["Intro", 2, 250]);
  expect([docs.title, docs.pageIndex, docs.url]).toEqual(["Docs", null, "https://example.com"]);
  expect(useEditorStore.getState()._past).toHaveLength(0);
});

test("bookmark edits are undoable and redoable", async () => {
  const file = await pdfFile(3, "doc.pdf");
  const store = useEditorStore.getState;
  store().setFile(file);
  store().setNumPages(3);
  store().applyLoadedBookmarks(file, []);

  store().addBookmark(bm("A", 0));
  store().addBookmark(bm("B", 1));
  store().updateBookmark("B", { title: "Bee" });
  store().moveBookmark("B", "indent");
  expect(shape(store().bookmarks)).toBe("A(Bee)");
  // An impossible move adds no history entry.
  const depth = store()._past.length;
  store().moveBookmark("A", "up");
  expect(store()._past).toHaveLength(depth);

  store().deleteBookmark("A");
  expect(store().bookmarks).toEqual([]);
  store().undo();
  expect(shape(store().bookmarks)).toBe("A(Bee)");
  store().undo();
  expect(shape(store().bookmarks)).toBe("A, Bee");
  store().undo();
  expect(shape(store().bookmarks)).toBe("A, B");
  store().redo();
  store().redo();
  expect(shape(store().bookmarks)).toBe("A(Bee)");
});

test("insertPages remaps bookmark pages; deleting a page leaves them pointing at it", async () => {
  const file = await pdfFile(3, "doc.pdf");
  const extra = await pdfFile(2, "extra.pdf");
  const store = useEditorStore.getState;
  store().setFile(file);
  store().setNumPages(3);
  store().applyLoadedBookmarks(file, [bm("P0", 0), bm("P1", 1, [bm("P2", 2)])]);

  // Insert 2 pages at visible slot 1 (before original page 1).
  await store().insertPages([{ kind: "pdf", file: extra }], 1);
  const pages = (t: Bookmark[]): (number | null)[] =>
    t.flatMap((b) => [b.pageIndex, ...pages(b.children)]);
  expect(pages(store().bookmarks)).toEqual([0, 3, 4]);
  expect(store().pageOrder).toEqual([0, 1, 2, 3, 4]);

  // Undo restores the pre-insert indices along with the file.
  store().undo();
  expect(pages(store().bookmarks)).toEqual([0, 1, 2]);
  store().redo();

  store().deletePage(3);
  expect(pages(store().bookmarks)).toEqual([0, 3, 4]);
  expect(store().pageOrder).not.toContain(3);
});
