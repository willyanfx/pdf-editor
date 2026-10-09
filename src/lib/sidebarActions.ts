import { useEditorStore } from "../store/useEditorStore";
import { useBookmarksUiStore } from "../store/useBookmarksUiStore";
import { useToastStore } from "../store/useToastStore";
import { useViewerStore } from "../store/useViewerStore";

/** Open the sidebar on the Attachments view, or say there's nothing to show. */
export function showAttachments(): void {
  if (!useEditorStore.getState().file) return;
  if (useViewerStore.getState().attachments.length === 0) {
    useToastStore.getState().addToast("This document has no attachments.", "info");
    return;
  }
  useBookmarksUiStore.getState().showTab("attachments");
}

/** Open the sidebar on the Layers view, or say there's nothing to show. */
export function showLayers(): void {
  if (!useEditorStore.getState().file) return;
  if (!useViewerStore.getState().layers) {
    useToastStore.getState().addToast("This document has no layers.", "info");
    return;
  }
  useBookmarksUiStore.getState().showTab("layers");
}
