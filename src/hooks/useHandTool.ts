import { useEffect, useState, type RefObject } from "react";
import { useEditorStore } from "../store/useEditorStore";

/** Places where Space belongs to what's there: text entry, menus and dialogs, the
 * sidebar and the find bar. */
const SPACE_OWNERS =
  "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox'], .side-panel, .find-bar";

/** Space pans from the page stage, or from nowhere in particular — including a
 * toolbar button that merely kept focus after a mouse click. A control the user
 * reached with the keyboard (Tab) keeps Space for itself: it activates it.
 * (`:focus-visible` can't tell the two apart once a key is down — browsers flip it
 * on the Space keydown itself — so the caller tracks how focus last moved.) */
function spaceBelongsToStage(target: EventTarget | null, focusedByKeyboard: boolean): boolean {
  const el = target as Element | null;
  if (!el?.closest) return true;
  if (el.closest(SPACE_OWNERS)) return false;
  const onControl = el !== document.body && el !== document.documentElement;
  return !(onControl && focusedByKeyboard);
}

/**
 * The hand tool: dragging pans the page stage. Active in "hand" mode, or
 * temporarily while Space is held in any mode (the Acrobat/Figma convention).
 * Returns whether the stage should currently behave as a hand — the CSS makes
 * everything on the pages inert so the drag always reaches the stage.
 *
 * `file` only exists so the effects re-run once a document mounts the scroll
 * container.
 */
export function useHandTool(scrollRef: RefObject<HTMLElement | null>, file: File | null): boolean {
  const mode = useEditorStore((s) => s.mode);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const active = mode === "hand" || spaceHeld;

  // Space-to-pan.
  useEffect(() => {
    if (!file) return;
    // Whether Space is currently ours, so its keyup can swallow the click a
    // focused button would otherwise get from it.
    let engaged = false;
    // How focus last moved: Tab means keyboard, a pointer press means mouse.
    let focusedByKeyboard = false;
    const onPointerDown = () => {
      focusedByKeyboard = false;
    };
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab") focusedByKeyboard = true;
      if (e.code !== "Space" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!engaged && (e.repeat || !spaceBelongsToStage(e.target, focusedByKeyboard))) return;
      engaged = true;
      e.preventDefault(); // otherwise Space scrolls the page
      if (!e.repeat) setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (engaged) e.preventDefault();
      engaged = false;
      setSpaceHeld(false);
    }
    const release = () => {
      engaged = false;
      setSpaceHeld(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // A key released while another window had focus never reports keyup.
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      setSpaceHeld(false);
    };
  }, [file]);

  // The drag itself. Touch is left to the browser's native scrolling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;

    function endDrag(pointerId: number) {
      if (!el) return;
      drag = null;
      el.classList.remove("is-panning");
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    }

    function onPointerDown(e: PointerEvent) {
      if (!el || e.button !== 0 || e.pointerType === "touch") return;
      // The sidebar lives inside the scroll container's DOM but isn't the stage.
      if ((e.target as Element).closest(".side-panel")) return;
      // A press on the stage's own scrollbar belongs to the scrollbar.
      if (e.target === el && (e.offsetX >= el.clientWidth || e.offsetY >= el.clientHeight)) return;
      drag = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
      };
      try {
        // Keeps the drag alive when the pointer leaves the stage.
        el.setPointerCapture(e.pointerId);
      } catch {
        // Not a capturable pointer; the drag still works while it stays over the stage.
      }
      el.classList.add("is-panning");
      e.preventDefault();
    }
    function onPointerMove(e: PointerEvent) {
      if (!el || !drag || e.pointerId !== drag.pointerId) return;
      // The button came up somewhere we never heard about (another window).
      if ((e.buttons & 1) === 0) return endDrag(e.pointerId);
      el.scrollLeft = drag.left - (e.clientX - drag.x);
      el.scrollTop = drag.top - (e.clientY - drag.y);
    }
    function onPointerEnd(e: PointerEvent) {
      if (drag && e.pointerId === drag.pointerId) endDrag(e.pointerId);
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    el.addEventListener("lostpointercapture", onPointerEnd);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("lostpointercapture", onPointerEnd);
      el.classList.remove("is-panning");
    };
  }, [scrollRef, active, file]);

  return active;
}
