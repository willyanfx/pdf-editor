import { useEffect, useRef } from "react";

/**
 * Trap focus inside a dialog and close it on Escape. Returns a ref to attach to
 * the dialog container. While active it:
 *  - moves focus into the dialog on mount (first focusable, or the container),
 *  - keeps Tab / Shift+Tab cycling within the dialog,
 *  - calls `onClose` on Escape,
 *  - restores focus to the previously-focused element on unmount.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  // Keep onClose in a ref so an inline (non-memoized) callback from the caller
  // doesn't re-run this effect — and tear down/re-attach the trap — every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus inside the dialog if it isn't already there.
    if (!node.contains(document.activeElement)) {
      (focusables()[0] ?? node).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
    // onClose is read through onCloseRef, so it's intentionally not a dep.
  }, [active]);

  return ref;
}
