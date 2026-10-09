import type { PDFDocumentProxy } from "pdfjs-dist";
import { newBookmarkId, type Bookmark } from "./bookmarks";
import { useEditorStore } from "../store/useEditorStore";

/** The slice of pdf.js's document proxy the reader needs (keeps it testable
 * against the legacy Node build and easy to fake). */
export type OutlineSource = Pick<
  PDFDocumentProxy,
  "getOutline" | "getDestination" | "getPageIndex"
>;

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

/**
 * Read the document outline into editor bookmarks. Each destination — an
 * explicit array or a named destination — is resolved to an ORIGINAL page
 * index; the /XYZ (or FitH/FitBH/FitR) top is kept when present.
 *
 * Entries that don't lead to a page are kept rather than dropped, so that
 * re-exporting doesn't silently delete them: web links keep their `url`, and
 * anything else (named actions, JavaScript, links into other files, broken
 * destinations) becomes a title-only entry with `pageIndex: null`. The panel
 * shows both as not navigable.
 */
export async function readOutline(pdf: OutlineSource): Promise<Bookmark[]> {
  const outline = await pdf.getOutline();
  if (!outline || outline.length === 0) return [];
  return Promise.all(outline.map((item) => readItem(pdf, item)));
}

async function readItem(pdf: OutlineSource, item: OutlineNode): Promise<Bookmark> {
  const children = item.items?.length
    ? await Promise.all(item.items.map((child) => readItem(pdf, child)))
    : [];
  const target = await resolveDest(pdf, item.dest);
  const bookmark: Bookmark = {
    id: newBookmarkId(),
    title: cleanTitle(item.title),
    pageIndex: target?.pageIndex ?? null,
    children,
  };
  if (target?.top !== undefined) bookmark.top = target.top;
  const url = item.url ?? item.unsafeUrl;
  if (!target && url) bookmark.url = url;
  return bookmark;
}

async function resolveDest(
  pdf: OutlineSource,
  dest: OutlineNode["dest"],
): Promise<{ pageIndex: number; top?: number } | null> {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const pageIndex = await pageIndexOf(pdf, explicit[0]);
    if (pageIndex === null) return null;
    const top = topOf(explicit);
    return top === undefined ? { pageIndex } : { pageIndex, top };
  } catch {
    // Unknown named destination or a ref that isn't a page: no page target.
    return null;
  }
}

async function pageIndexOf(pdf: OutlineSource, target: unknown): Promise<number | null> {
  // Some writers put a bare page number where the page ref belongs.
  if (typeof target === "number") return Number.isInteger(target) && target >= 0 ? target : null;
  if (target && typeof target === "object" && "num" in target && "gen" in target) {
    return pdf.getPageIndex(target as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
  }
  return null;
}

/** The vertical scroll target of an explicit destination, in PDF user space. */
function topOf(dest: unknown[]): number | undefined {
  const kind = (dest[1] as { name?: string } | undefined)?.name;
  const at =
    kind === "XYZ" ? 3 : kind === "FitH" || kind === "FitBH" ? 2 : kind === "FitR" ? 5 : -1;
  const value = at >= 0 ? dest[at] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Titles can carry stray control characters (NULs, line breaks); keep text only. */
function cleanTitle(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = (title ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return cleaned || "Untitled";
}

/**
 * Read the outline of the document the viewer just loaded and hand it to the
 * store. The store ignores the result if a different file has been opened
 * meanwhile or this document's bookmarks were already set, and the load never
 * creates an undo step.
 */
export async function loadOutlineIntoStore(pdf: OutlineSource, file: File | null): Promise<void> {
  if (!file) return;
  if (useEditorStore.getState().outlineStatus !== "pending") return;
  let tree: Bookmark[] | null;
  try {
    tree = await readOutline(pdf);
  } catch (err) {
    console.warn("[outline] could not read bookmarks:", err);
    tree = null;
  }
  useEditorStore.getState().applyLoadedBookmarks(file, tree);
}
