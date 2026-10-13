import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { usePageSelectionStore } from "../store/usePageSelectionStore";
import { useExportToolsUi } from "../store/useExportToolsUi";
import type { PageScope } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { inVisibleOrder } from "../lib/pageRemap";

/** Shared dialog chrome: backdrop, focus trap, header with a close button. */
export function DialogShell({
  title,
  busy,
  children,
}: {
  title: string;
  busy: boolean;
  children: ReactNode;
}) {
  const onClose = () => {
    // Closing mid-export would orphan the running job's UI; let it finish.
    if (!busy) useExportToolsUi.getState().close();
  };
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);
  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sig-header">
          <span>{title}</span>
          <button
            type="button"
            className="sig-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/** Radio group choosing which pages an export covers. */
export function ScopeChoice({
  scope,
  onChange,
  disabled,
}: {
  scope: PageScope;
  onChange: (scope: PageScope) => void;
  disabled: boolean;
}) {
  const numPages = useEditorStore((s) => s.pageOrder.length || s.numPages);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const selected = usePageSelectionStore((s) => s.selected);
  const selectedCount = inVisibleOrder(pageOrder, selected).length;
  const options: { value: PageScope; label: string; hidden?: boolean }[] = [
    { value: "all", label: `All pages (${numPages})` },
    { value: "current", label: "Current page" },
    {
      value: "selected",
      label: `Selected pages (${selectedCount})`,
      hidden: selectedCount === 0,
    },
  ];
  return (
    <fieldset className="export-fieldset" disabled={disabled}>
      <legend>Pages</legend>
      {options
        .filter((o) => !o.hidden)
        .map((o) => (
          <label key={o.value} className="export-opt">
            <input
              type="radio"
              name="export-scope"
              checked={scope === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
    </fieldset>
  );
}

/** Scope a dialog opens with: the page-panel selection when there is one. */
export function initialScope(): PageScope {
  const { pageOrder } = useEditorStore.getState();
  const selected = inVisibleOrder(pageOrder, usePageSelectionStore.getState().selected);
  return selected.length ? "selected" : "all";
}
