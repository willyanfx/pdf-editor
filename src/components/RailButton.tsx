import { useEffect, useState, type ReactNode } from "react";

export type RailButtonProps = {
  icon: ReactNode;
  /** Accessible name and tooltip. A trailing "(X)" is shown as the shortcut key. */
  tip: string;
  active?: boolean;
  /** When true, the button is a toggle and exposes its state via aria-pressed. */
  toggle?: boolean;
  disabled?: boolean;
  /** Extra aria attributes (e.g. aria-expanded, aria-haspopup). */
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog" | "menu" | "listbox" | "tree" | "grid" | boolean;
  onClick: () => void;
};

/** Split "Highlight (H)" into its label and shortcut; long parentheticals stay in the label. */
function splitTip(tip: string): { label: string; shortcut: string | null } {
  const m = /^(.*?)\s*\(([^()]{1,12})\)$/.exec(tip);
  return m ? { label: m[1], shortcut: m[2] } : { label: tip, shortcut: null };
}

export function RailButton({
  icon,
  tip,
  active,
  toggle,
  disabled,
  onClick,
  ...aria
}: RailButtonProps) {
  // Tooltip anchor in viewport coordinates (the tip is position: fixed).
  const [tipAt, setTipAt] = useState<{ top: number; left: number } | null>(null);
  const { label, shortcut } = splitTip(tip);

  // The fixed tip doesn't follow its button, so drop it once anything scrolls
  // (the rail scrolls on short windows) or the window resizes.
  useEffect(() => {
    if (!tipAt) return;
    const hide = () => setTipAt(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [tipAt]);

  function showTip(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setTipAt({ top: r.top + r.height / 2, left: r.right + 12 });
  }

  return (
    <button
      type="button"
      className={active ? "rail-btn active" : "rail-btn"}
      aria-label={tip}
      aria-pressed={toggle ? !!active : undefined}
      disabled={disabled}
      onClick={() => {
        setTipAt(null);
        onClick();
      }}
      onMouseEnter={(e) => showTip(e.currentTarget)}
      onMouseLeave={() => setTipAt(null)}
      // Keyboard users get the same tooltip; a mouse click's focus doesn't.
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) showTip(e.currentTarget);
      }}
      onBlur={() => setTipAt(null)}
      {...aria}
    >
      {icon}
      {tipAt && !aria["aria-expanded"] && (
        <span className="rail-tip" aria-hidden="true" style={tipAt}>
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </span>
      )}
    </button>
  );
}
