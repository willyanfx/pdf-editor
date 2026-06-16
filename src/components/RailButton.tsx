import type { ReactNode } from "react";

export type RailButtonProps = {
  icon: ReactNode;
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

export function RailButton({
  icon,
  tip,
  active,
  toggle,
  disabled,
  onClick,
  ...aria
}: RailButtonProps) {
  return (
    <button
      type="button"
      className={active ? "rail-btn active" : "rail-btn"}
      data-tip={tip}
      aria-label={tip}
      aria-pressed={toggle ? !!active : undefined}
      disabled={disabled}
      onClick={onClick}
      {...aria}
    >
      {icon}
    </button>
  );
}
