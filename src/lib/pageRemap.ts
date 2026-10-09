import type { PageOp, PdfEdit } from "../store/useEditorStore";
import type { Bookmark } from "./bookmarks";

/*
 * Pure page-structure planning. Every operation that rewrites the open File's
 * pages (insert, duplicate, replace) is described as a PagePlan; the bytes are
 * built from it by lib/pageOrganize.ts and the store's page-indexed state is
 * remapped from it by remapPageState below. No pdf-lib here, so the store can
 * import this statically without pulling pdf-lib into the main chunk.
 */

/** One page of the rewritten file, in physical order. */
export type LayoutEntry =
  /** Page `index` of the current file. `clone` marks an extra, independent copy
   * of it; the un-flagged entry is the page itself and keeps its edits. */
  | { kind: "base"; index: number; clone?: boolean }
  /** Page `index` of the extra document passed alongside the plan (inserted or
   * replacement pages). */
  | { kind: "new"; index: number };

export type PagePlan = {
  /** Physical page order of the rewritten file. */
  layout: LayoutEntry[];
  /** New visible order, as indices into `layout` (= page indices of the new file). */
  pageOrder: number[];
};

/**
 * Every piece of document state keyed by page index. remapPageState and
 * removePagesFromState are the ONLY places that rewrite it, so page-structure
 * operations stay correct as the model grows: when you add new page-indexed
 * state (bookmarks, links, form-field metadata, ...), add it to this type and
 * handle it in both functions — every insert/duplicate/replace/delete picks it up.
 */
export type PageIndexedState = {
  edits: PdfEdit[];
  pageOps: PageOp[];
  pageOrder: number[];
  /** Bookmarks follow their page; they are not copied onto duplicates. */
  bookmarks: Bookmark[];
};

/** Retarget bookmarks to their page's new index. A bookmark whose page left the
 * file (replaced) keeps its title but loses its target, since no page is left
 * to point at. */
function remapBookmarks(tree: Bookmark[], moved: Map<number, number>): Bookmark[] {
  return tree.map((b) => ({
    ...b,
    pageIndex: b.pageIndex === null ? null : (moved.get(b.pageIndex) ?? null),
    children: remapBookmarks(b.children, moved),
  }));
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Where each surviving (non-clone) base page lands in the plan's layout. */
function survivorPositions(layout: LayoutEntry[]): Map<number, number> {
  const moved = new Map<number, number>();
  layout.forEach((e, pos) => {
    if (e.kind === "base" && !e.clone) moved.set(e.index, pos);
  });
  return moved;
}

/** `pageOrder` filtered to `pages`, i.e. the pages in the order the user sees them. */
export function inVisibleOrder(pageOrder: number[], pages: Iterable<number>): number[] {
  const set = new Set(pages);
  return pageOrder.filter((i) => set.has(i));
}

/**
 * Insert `count` pages from the extra document at visible slot `position`
 * (0 = before the first visible page, pageOrder.length = after the last). They
 * go physically right before the base page that currently sits in that slot.
 */
export function planInsert(
  baseCount: number,
  pageOrder: number[],
  position: number,
  count: number,
): PagePlan {
  const slot = Math.max(0, Math.min(position, pageOrder.length));
  const at = slot < pageOrder.length ? pageOrder[slot] : baseCount;
  const layout: LayoutEntry[] = [
    ...range(0, at).map((index) => ({ kind: "base" as const, index })),
    ...range(0, count).map((index) => ({ kind: "new" as const, index })),
    ...range(at, baseCount).map((index) => ({ kind: "base" as const, index })),
  ];
  const moved = survivorPositions(layout);
  const order = pageOrder.map((i) => moved.get(i)!);
  order.splice(slot, 0, ...range(at, at + count));
  return { layout, pageOrder: order };
}

/** Put a real copy of each selected (visible) page right after it. */
export function planDuplicate(
  baseCount: number,
  pageOrder: number[],
  selected: number[],
): PagePlan {
  const sel = new Set(inVisibleOrder(pageOrder, selected));
  const layout: LayoutEntry[] = [];
  const clonePos = new Map<number, number>();
  for (let index = 0; index < baseCount; index++) {
    layout.push({ kind: "base", index });
    if (sel.has(index)) {
      clonePos.set(index, layout.length);
      layout.push({ kind: "base", index, clone: true });
    }
  }
  const moved = survivorPositions(layout);
  const order = pageOrder.flatMap((i) =>
    sel.has(i) ? [moved.get(i)!, clonePos.get(i)!] : [moved.get(i)!],
  );
  return { layout, pageOrder: order };
}

/**
 * Replace the selected pages with `sourcePages` (page indices of the extra
 * document), in place. In visible order, replacement j takes the slot of
 * selected page j. Extra replacements go right after the last selected page;
 * if there are fewer replacements than selected pages, the leftover selected
 * pages are simply removed.
 */
export function planReplace(
  baseCount: number,
  pageOrder: number[],
  selected: number[],
  sourcePages: number[],
): PagePlan {
  const targets = inVisibleOrder(pageOrder, selected);
  if (!targets.length || !sourcePages.length) {
    throw new Error("Pick at least one page to replace and one page to replace it with.");
  }
  const assigned = new Map<number, number[]>();
  targets.forEach((t, j) => assigned.set(t, j < sourcePages.length ? [sourcePages[j]] : []));
  assigned.get(targets[targets.length - 1])!.push(...sourcePages.slice(targets.length));

  const layout: LayoutEntry[] = [];
  const newPos = new Map<number, number[]>();
  for (let index = 0; index < baseCount; index++) {
    const replacements = assigned.get(index);
    if (!replacements) {
      layout.push({ kind: "base", index });
      continue;
    }
    newPos.set(
      index,
      replacements.map((src) => layout.push({ kind: "new", index: src }) - 1),
    );
  }
  const moved = survivorPositions(layout);
  const order = pageOrder.flatMap((i) => newPos.get(i) ?? [moved.get(i)!]);
  return { layout, pageOrder: order };
}

/**
 * Carry page-indexed state across a rewrite: state on surviving pages follows
 * them to their new index, clone pages get a copy (fresh edit ids) of their
 * source page's state, and state on pages the plan drops (replaced) is dropped.
 */
export function remapPageState(
  state: PageIndexedState,
  plan: PagePlan,
  newId: () => string = () => crypto.randomUUID(),
): PageIndexedState {
  const moved = survivorPositions(plan.layout);
  const clones = new Map<number, number[]>();
  plan.layout.forEach((e, pos) => {
    if (e.kind === "base" && e.clone) clones.set(e.index, [...(clones.get(e.index) ?? []), pos]);
  });

  const edits: PdfEdit[] = [];
  const pageOps: PageOp[] = [];
  for (const edit of state.edits) {
    const to = moved.get(edit.pageIndex);
    if (to !== undefined) edits.push({ ...edit, pageIndex: to });
  }
  for (const op of state.pageOps) {
    const to = moved.get(op.pageIndex);
    if (to !== undefined) pageOps.push({ ...op, pageIndex: to });
  }
  for (const edit of state.edits) {
    for (const to of clones.get(edit.pageIndex) ?? []) {
      edits.push({ ...structuredClone(edit), id: newId(), pageIndex: to });
    }
  }
  for (const op of state.pageOps) {
    for (const to of clones.get(op.pageIndex) ?? []) {
      pageOps.push({ ...structuredClone(op), pageIndex: to });
    }
  }
  return {
    edits,
    pageOps,
    pageOrder: plan.pageOrder,
    bookmarks: remapBookmarks(state.bookmarks, moved),
  };
}

/** Drop pages from the visible order along with everything keyed to them. */
export function removePagesFromState(
  state: PageIndexedState,
  pages: Iterable<number>,
): PageIndexedState {
  const drop = new Set(pages);
  return {
    edits: state.edits.filter((e) => !drop.has(e.pageIndex)),
    pageOps: state.pageOps.filter((op) => !drop.has(op.pageIndex)),
    pageOrder: state.pageOrder.filter((i) => !drop.has(i)),
    // Bookmarks keep pointing at the removed page: the panel shows them as
    // deleted and export drops them, promoting their children.
    bookmarks: state.bookmarks,
  };
}

/** Page indices (in the rewritten file) of the pages a plan created. */
export function createdPages(plan: PagePlan): number[] {
  return plan.pageOrder.filter((pos) => {
    const e = plan.layout[pos];
    return e.kind === "new" || e.clone === true;
  });
}

// ── Selection ──────────────────────────────────────────────────────────────

/**
 * Next selection after clicking page `clicked`: a plain click selects just it,
 * toggle (⌘/Ctrl) adds or removes it, range (Shift) selects everything between
 * the anchor and it in visible order. The anchor moves on plain/toggle clicks.
 */
export function clickSelection(
  current: number[],
  anchor: number | null,
  clicked: number,
  pageOrder: number[],
  mods: { toggle: boolean; range: boolean },
): { selected: number[]; anchor: number } {
  if (mods.range && anchor !== null && pageOrder.includes(anchor)) {
    const a = pageOrder.indexOf(anchor);
    const b = pageOrder.indexOf(clicked);
    const span = pageOrder.slice(Math.min(a, b), Math.max(a, b) + 1);
    const selected = mods.toggle ? inVisibleOrder(pageOrder, [...current, ...span]) : span;
    return { selected, anchor };
  }
  if (mods.toggle) {
    const selected = current.includes(clicked)
      ? current.filter((i) => i !== clicked)
      : inVisibleOrder(pageOrder, [...current, clicked]);
    return { selected, anchor: clicked };
  }
  return { selected: [clicked], anchor: clicked };
}

/**
 * Move every page in `group` (keeping their relative visible order) into
 * insertion gap `gap` of `pageOrder` (0 = before the first page).
 */
export function moveGroup(pageOrder: number[], group: Iterable<number>, gap: number): number[] {
  const set = new Set(group);
  const moving = pageOrder.filter((i) => set.has(i));
  const rest = pageOrder.filter((i) => !set.has(i));
  const at = pageOrder.slice(0, gap).filter((i) => !set.has(i)).length;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

// ── Page ranges ────────────────────────────────────────────────────────────

/**
 * Parse a 1-based page list like "1-3, 5, 9-7" into 0-based indices, in the
 * order written (a reversed range counts down). Returns an error message the UI
 * can show instead of silently ignoring bad input.
 */
export function parsePageList(
  spec: string,
  pageCount: number,
): { pages: number[]; error: null } | { pages: null; error: string } {
  const pages: number[] = [];
  const tokens = spec
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return { pages: null, error: "Enter at least one page number." };
  for (const token of tokens) {
    const m = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { pages: null, error: `"${token}" isn't a page number or range like 2-4.` };
    const a = Number.parseInt(m[1], 10);
    const b = m[2] === undefined ? a : Number.parseInt(m[2], 10);
    for (const p of [a, b]) {
      if (p < 1 || p > pageCount) {
        return {
          pages: null,
          error:
            pageCount === 1
              ? `Page ${p} doesn't exist — that file has only 1 page.`
              : `Page ${p} doesn't exist — pick pages 1 to ${pageCount}.`,
        };
      }
    }
    const step = a <= b ? 1 : -1;
    for (let p = a; p !== b + step; p += step) pages.push(p - 1);
  }
  return { pages, error: null };
}

/** Format 1-based page numbers compactly: [1, 2, 3, 5] → "1-3,5". */
export function formatPageRanges(pageNumbers: number[]): string {
  const sorted = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return parts.join(",");
}
