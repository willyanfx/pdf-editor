import { useEditorStore } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";

/**
 * Follow an internal PDF link (GoTo / named destination) to `pageIndex`, the
 * target's index in the LOADED document. The viewer lays pages out by that same
 * original index (reordering only changes the organizer and the export), so it
 * is exactly what scrollToPage expects. A target the user deleted in the
 * organizer has no page to land on, so say so instead of scrolling to a gap.
 *
 * Reads the store at call time: react-pdf captures the first onItemClick it is
 * given, so this must not close over component state.
 */
export function goToLinkedPage(pageIndex: number) {
  const { pageOrder, numPages, scrollToPage } = useEditorStore.getState();
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= numPages) return;
  if (pageOrder.length > 0 && !pageOrder.includes(pageIndex)) {
    useToastStore.getState().addToast("That link goes to a page you deleted.", "info");
    return;
  }
  scrollToPage?.(pageIndex);
}

/** Link attributes for external (URI) links: always a new tab, and never hand
 * the opened page a reference back to the editor or leak the document URL. */
export const EXTERNAL_LINK_TARGET = "_blank" as const;
export const EXTERNAL_LINK_REL = "noopener noreferrer nofollow";
