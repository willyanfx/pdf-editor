/**
 * Bookmarks (the PDF "outline"): the document-data type plus pure, immutable
 * tree operations. No pdf.js / pdf-lib imports here so the store can use it
 * statically; reading lives in outlineRead.ts and writing in outline.ts.
 */

export type Bookmark = {
  id: string;
  title: string;
  /** ORIGINAL page index (the same index space as edits/pageOps). null means
   * the entry has no page destination: a web link (`url`) or an action we
   * can't follow (named action, JavaScript, link to another file, broken
   * destination). Those entries are kept so export doesn't silently lose them,
   * but they can't be navigated to. */
  pageIndex: number | null;
  /** Vertical target from the source destination, in the page's PDF user space
   * (the /XYZ "top"). It is NOT a screen coordinate: the editor never draws
   * with it, it is only passed back into the exported destination, and PDF user
   * space is unchanged by our rotate/crop/reorder ops. Cleared when the
   * destination is retargeted. */
  top?: number;
  /** Web link for outline entries that open a URL instead of a page. */
  url?: string;
  children: Bookmark[];
};

/** Where a bookmark sits: the sibling array that holds it, its index there,
 * its parent (null = top level) and its depth (0 = top level). */
export type BookmarkLocation = {
  node: Bookmark;
  siblings: Bookmark[];
  index: number;
  parent: Bookmark | null;
  depth: number;
};

export type BookmarkMove = "up" | "down" | "indent" | "outdent";
export type BookmarkDropPlace = "before" | "after" | "inside";

export function newBookmarkId(): string {
  return crypto.randomUUID();
}

export function makeBookmark(
  partial: Partial<Bookmark> & Pick<Bookmark, "title" | "pageIndex">,
): Bookmark {
  return { id: newBookmarkId(), children: [], ...partial };
}

export function findBookmark(
  tree: Bookmark[],
  id: string,
  parent: Bookmark | null = null,
  depth = 0,
): BookmarkLocation | null {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (node.id === id) return { node, siblings: tree, index: i, parent, depth };
    const hit = findBookmark(node.children, id, node, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Total number of bookmarks in the tree (all depths). */
export function countBookmarks(tree: Bookmark[]): number {
  return tree.reduce((n, b) => n + 1 + countBookmarks(b.children), 0);
}

/** Every id in the tree, depth-first. */
export function allBookmarkIds(tree: Bookmark[]): string[] {
  return tree.flatMap((b) => [b.id, ...allBookmarkIds(b.children)]);
}

/** Rebuild the tree, replacing the children of every node via `fn` (bottom-up). */
function mapChildren(tree: Bookmark[], fn: (siblings: Bookmark[]) => Bookmark[]): Bookmark[] {
  return fn(tree.map((b) => ({ ...b, children: mapChildren(b.children, fn) })));
}

export function updateBookmark(
  tree: Bookmark[],
  id: string,
  patch: Partial<Omit<Bookmark, "id" | "children">>,
): Bookmark[] {
  return tree.map((b) =>
    b.id === id
      ? { ...b, ...patch, children: b.children }
      : { ...b, children: updateBookmark(b.children, id, patch) },
  );
}

/** Remove a bookmark together with its children. */
export function removeBookmark(tree: Bookmark[], id: string): Bookmark[] {
  return mapChildren(tree, (siblings) => siblings.filter((b) => b.id !== id));
}

/**
 * Insert `node` as the next sibling of `afterId`, or into the top level at
 * `topLevelIndex` (default: the end) when afterId is absent or not found.
 */
export function insertBookmark(
  tree: Bookmark[],
  node: Bookmark,
  opts: { afterId?: string | null; topLevelIndex?: number } = {},
): Bookmark[] {
  if (opts.afterId && findBookmark(tree, opts.afterId)) {
    const afterId = opts.afterId;
    return mapChildren(tree, (siblings) => {
      const i = siblings.findIndex((b) => b.id === afterId);
      return i < 0 ? siblings : [...siblings.slice(0, i + 1), node, ...siblings.slice(i + 1)];
    });
  }
  const at = Math.max(0, Math.min(opts.topLevelIndex ?? tree.length, tree.length));
  return [...tree.slice(0, at), node, ...tree.slice(at)];
}

/**
 * Top-level slot for a new bookmark on `pageIndex` that keeps a page-ordered
 * outline in page order: after the last top-level bookmark whose page comes at
 * or before it. `pagePosition` maps an original page index to its visible
 * position (or -1 when the page is gone).
 */
export function topLevelSlotForPage(
  tree: Bookmark[],
  pageIndex: number,
  pagePosition: (pageIndex: number) => number,
): number {
  const target = pagePosition(pageIndex);
  let slot = 0;
  tree.forEach((b, i) => {
    const pos = b.pageIndex === null ? -1 : pagePosition(b.pageIndex);
    if (pos >= 0 && pos <= target) slot = i + 1;
  });
  return slot;
}

/**
 * Keyboard-style restructuring of one bookmark (children travel with it):
 * - up/down: swap with the previous/next sibling;
 * - indent: become the last child of the previous sibling;
 * - outdent: move out of the parent, right after it.
 * Returns the same tree reference when the move isn't possible.
 */
export function moveBookmark(tree: Bookmark[], id: string, move: BookmarkMove): Bookmark[] {
  const loc = findBookmark(tree, id);
  if (!loc) return tree;
  const { node, index, siblings, parent } = loc;

  if (move === "up" || move === "down") {
    const to = move === "up" ? index - 1 : index + 1;
    if (to < 0 || to >= siblings.length) return tree;
    const swapped = [...siblings];
    [swapped[index], swapped[to]] = [swapped[to], swapped[index]];
    return replaceSiblings(tree, parent?.id ?? null, swapped);
  }

  if (move === "indent") {
    if (index === 0) return tree;
    const prev = siblings[index - 1];
    const without = removeBookmark(tree, id);
    return mapChildren(without, (sibs) =>
      sibs.map((b) => (b.id === prev.id ? { ...b, children: [...b.children, node] } : b)),
    );
  }

  // outdent
  if (!parent) return tree;
  return insertAfterAnywhere(removeBookmark(tree, id), parent.id, node);
}

/**
 * Drag-and-drop move: put `id` before/after `targetId`, or as the last child
 * of it ("inside"). Dropping a bookmark onto itself or into its own subtree is
 * rejected (returns the same tree reference).
 */
export function moveBookmarkTo(
  tree: Bookmark[],
  id: string,
  targetId: string,
  place: BookmarkDropPlace,
): Bookmark[] {
  if (id === targetId) return tree;
  const loc = findBookmark(tree, id);
  if (!loc || !findBookmark(tree, targetId)) return tree;
  if (findBookmark(loc.node.children, targetId)) return tree;
  const without = removeBookmark(tree, id);
  const node = loc.node;
  if (place === "inside") {
    return mapChildren(without, (sibs) =>
      sibs.map((b) => (b.id === targetId ? { ...b, children: [...b.children, node] } : b)),
    );
  }
  return mapChildren(without, (sibs) => {
    const i = sibs.findIndex((b) => b.id === targetId);
    if (i < 0) return sibs;
    const at = place === "before" ? i : i + 1;
    return [...sibs.slice(0, at), node, ...sibs.slice(at)];
  });
}

function insertAfterAnywhere(tree: Bookmark[], afterId: string, node: Bookmark): Bookmark[] {
  return mapChildren(tree, (sibs) => {
    const i = sibs.findIndex((b) => b.id === afterId);
    return i < 0 ? sibs : [...sibs.slice(0, i + 1), node, ...sibs.slice(i + 1)];
  });
}

function replaceSiblings(
  tree: Bookmark[],
  parentId: string | null,
  siblings: Bookmark[],
): Bookmark[] {
  if (parentId === null) return siblings;
  return tree.map((b) =>
    b.id === parentId
      ? { ...b, children: siblings }
      : { ...b, children: replaceSiblings(b.children, parentId, siblings) },
  );
}

/** A bookmark resolved against the exported page order. */
export type OutputBookmark = {
  title: string;
  /** Page position in the OUTPUT document, or null for link/no-destination entries. */
  outPage: number | null;
  top?: number;
  url?: string;
  children: OutputBookmark[];
};

/**
 * Translate original page indices to output pages via export's `origToOut`
 * (original index → output position, -1 when dropped). A bookmark whose page
 * was deleted is removed and its children take its place, so nothing nested
 * under a deleted chapter is lost. Entries without a page (links) are kept.
 */
export function resolveBookmarksForOutput(
  tree: Bookmark[],
  origToOut: readonly number[],
): OutputBookmark[] {
  return tree.flatMap((b): OutputBookmark[] => {
    const children = resolveBookmarksForOutput(b.children, origToOut);
    if (b.pageIndex === null) {
      return [{ title: b.title, outPage: null, url: b.url, children }];
    }
    const outPage = origToOut[b.pageIndex] ?? -1;
    if (outPage < 0) return children;
    return [{ title: b.title, outPage, top: b.top, children }];
  });
}

/**
 * What export should do with the outline: the bookmarks to write, or undefined
 * to leave the file's outline untouched. Once the file's outline has been read
 * ("ready") the bookmarks are authoritative — an empty list means the user
 * deleted them all, so the old outline is removed. If reading failed we only
 * write when the user has added bookmarks of their own.
 */
export function bookmarksForExport(state: {
  bookmarks: Bookmark[];
  outlineStatus: "pending" | "ready" | "failed";
}): Bookmark[] | undefined {
  return state.outlineStatus === "ready" || state.bookmarks.length > 0
    ? state.bookmarks
    : undefined;
}
