import { useViewerStore } from "../store/useViewerStore";
import { useToastStore } from "../store/useToastStore";

/** False where the Fullscreen API is missing or blocked (e.g. iPhone Safari,
 * sandboxed iframes). */
export function fullscreenSupported(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

/** Enter or leave browser full screen. The viewer store's `fullscreen` flag follows
 * the real state through `fullscreenchange`, so Esc and F11 stay in sync. */
export async function toggleFullscreen(): Promise<void> {
  if (!fullscreenSupported()) {
    useToastStore.getState().addToast("Full screen isn't available in this browser.", "info");
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    useToastStore.getState().addToast("Couldn't switch to full screen.", "error");
  }
}

/** Mirror the browser's full-screen state into the viewer store; returns cleanup. */
export function watchFullscreen(): () => void {
  const sync = () => useViewerStore.getState().setFullscreen(!!document.fullscreenElement);
  document.addEventListener("fullscreenchange", sync);
  sync();
  return () => document.removeEventListener("fullscreenchange", sync);
}
