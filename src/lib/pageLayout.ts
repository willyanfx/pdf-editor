/**
 * Row layout for the page stage. Single-page view is one page per row; two-page
 * view pairs pages side by side. A row is the virtualizer's unit, so everything
 * that scrolls, fits or steps through pages goes through here.
 */

export type PageLayout = "single" | "two";

/** A row of pages, by original page index. Two-page rows always have two slots;
 * `null` marks an empty slot (the blank left side of a cover page, or the missing
 * partner of an odd final page). */
export type PageRow = (number | null)[];

/** Pair `pages` (original indices, in display order) into rows. With `cover`, the
 * first page sits alone on the right, like the cover of a book. */
export function buildPageRows(pages: number[], layout: PageLayout, cover: boolean): PageRow[] {
  if (layout === "single") return pages.map((p) => [p]);
  const rows: PageRow[] = [];
  let i = 0;
  if (cover && pages.length > 0) {
    rows.push([null, pages[0]]);
    i = 1;
  }
  for (; i < pages.length; i += 2) rows.push([pages[i], pages[i + 1] ?? null]);
  return rows;
}

/** The pages still in the document, in display order: everything except pages
 * the organizer removed. `pageOrder` is empty until the organizer seeds it. */
export function visiblePages(numPages: number, pageOrder: number[]): number[] {
  const all = Array.from({ length: numPages }, (_, i) => i);
  if (pageOrder.length === 0) return all;
  const kept = new Set(pageOrder);
  return all.filter((p) => kept.has(p));
}

/** Index of the row holding `pageIndex`, or -1 when it isn't shown. */
export function rowIndexOfPage(rows: PageRow[], pageIndex: number): number {
  return rows.findIndex((row) => row.includes(pageIndex));
}

/** The first real page of a row (the cover row's left slot is empty). */
export function firstPageOfRow(row: PageRow | undefined): number | null {
  return row?.find((p): p is number => p !== null) ?? null;
}

/** The last real page of a row. */
function lastPageOfRow(row: PageRow | undefined): number | null {
  return [...(row ?? [])].reverse().find((p): p is number => p !== null) ?? null;
}

/** The page to jump to when stepping a row forward (+1) or back (-1) from
 * `current`; null when already at that end. Single view steps one page. When
 * `current` isn't shown (the page was just deleted) it steps to the nearest shown
 * page in that direction. */
export function stepPage(rows: PageRow[], current: number, direction: 1 | -1): number | null {
  const at = rowIndexOfPage(rows, current);
  if (at >= 0) return firstPageOfRow(rows[at + direction]);
  if (direction === 1) {
    for (const row of rows) {
      const first = firstPageOfRow(row);
      if (first !== null && first > current) return first;
    }
    return null;
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const last = lastPageOfRow(rows[i]);
    if (last !== null && last < current) return firstPageOfRow(rows[i]);
  }
  return null;
}

/** The shown page closest to `pageIndex` (itself when shown); null when no page is
 * shown. Ties go to the earlier page. */
export function nearestShownPage(rows: PageRow[], pageIndex: number): number | null {
  let best: number | null = null;
  for (const row of rows) {
    for (const p of row) {
      if (p === null) continue;
      if (best === null || Math.abs(p - pageIndex) < Math.abs(best - pageIndex)) best = p;
    }
  }
  return best;
}

/** Pixel width of one row's content: pages side by side plus the gutter between. */
export function rowContentWidth(columns: number, pageWidth: number, columnGap: number): number {
  return columns * pageWidth + (columns - 1) * columnGap;
}

/** Height of a row: the tallest page in it (0 for an empty row). */
export function rowHeight(row: PageRow, pageHeight: (pageIndex: number) => number): number {
  let h = 0;
  for (const p of row) if (p !== null) h = Math.max(h, pageHeight(p));
  return h;
}
