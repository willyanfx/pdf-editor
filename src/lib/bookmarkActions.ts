import { useEditorStore } from "../store/useEditorStore";
import { useBookmarksUiStore } from "../store/useBookmarksUiStore";
import { useToastStore } from "../store/useToastStore";
import { findBookmark, makeBookmark, topLevelSlotForPage } from "./bookmarks";

/** The visible page order (falls back to natural order before it's seeded). */
function visibleOrder(): number[] {
  const { pageOrder, numPages } = useEditorStore.getState();
  return pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i);
}

/**
 * Add a bookmark for the page currently in view, then open the Bookmarks panel
 * with its title ready to type over. Like Acrobat, it goes right after the
 * selected bookmark; with nothing selected it joins the top level in page
 * order. Returns the new bookmark's id (null when nothing was added).
 */
export function addBookmarkForCurrentPage(): string | null {
  const store = useEditorStore.getState();
  if (!store.file) return null;
  if (store.outlineStatus === "pending") {
    useToastStore
      .getState()
      .addToast("Bookmarks are still loading. Try again in a moment.", "info");
    return null;
  }
  const order = visibleOrder();
  const pageIndex = store.selectedPageIndex;
  const position = order.indexOf(pageIndex);
  if (position < 0) {
    useToastStore.getState().addToast("This page was deleted, so it can't be bookmarked.", "error");
    return null;
  }

  const bookmark = makeBookmark({ title: `Page ${position + 1}`, pageIndex });
  const ui = useBookmarksUiStore.getState();
  const afterId =
    ui.selectedId && findBookmark(store.bookmarks, ui.selectedId) ? ui.selectedId : null;
  store.addBookmark(
    bookmark,
    afterId
      ? { afterId }
      : {
          topLevelIndex: topLevelSlotForPage(store.bookmarks, pageIndex, (i) => order.indexOf(i)),
        },
  );
  ui.reveal(bookmark.id, { rename: true });
  return bookmark.id;
}

/** Open the sidebar on the Bookmarks view. */
export function showBookmarks(): void {
  if (!useEditorStore.getState().file) return;
  useBookmarksUiStore.getState().reveal(null);
}
