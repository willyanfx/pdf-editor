import { Minimize } from "lucide-react";
import { toggleFullscreen } from "../lib/fullscreen";

/** Shown in full screen: an exit button that fades after a moment and returns on hover. */
export function FullscreenHint() {
  return (
    <button
      type="button"
      className="fs-exit"
      title="Exit full screen (Esc)"
      onClick={() => void toggleFullscreen()}
    >
      <Minimize size={14} aria-hidden="true" />
      <span>Exit full screen</span>
      <kbd>Esc</kbd>
    </button>
  );
}
