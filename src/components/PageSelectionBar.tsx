import { useMemo, useState, type ReactNode } from "react";
import {
  Copy,
  FileOutput,
  FilePlus,
  ImageDown,
  Replace,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { usePageSelectionStore } from "../store/usePageSelectionStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { inVisibleOrder } from "../lib/pageRemap";

/**
 * Contextual toolbar at the top of the page panel while pages are selected:
 * rotate, duplicate, add a blank page after, extract, replace, delete.
 */
export function PageSelectionBar() {
  const selected = usePageSelectionStore((s) => s.selected);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const pages = useMemo(() => inVisibleOrder(pageOrder, selected), [pageOrder, selected]);
  const actions = useEditorActions();
  // Duplicate / blank-page rewrite the whole file; block double-clicks meanwhile.
  const [busy, setBusy] = useState(false);

  if (!pages.length) return null;
  const n = pages.length;
  const noun = n === 1 ? "page" : "pages";
  const all = n >= pageOrder.length;

  async function runBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const button = (label: string, icon: ReactNode, onClick: () => void, extra?: string) => (
    <button
      type="button"
      className={extra}
      title={label}
      aria-label={label}
      disabled={busy || (extra === "danger" && all)}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div className="page-sel-bar" role="toolbar" aria-label={`Actions for ${n} selected ${noun}`}>
      <div className="page-sel-head">
        <span aria-live="polite">
          {n} {noun} selected
        </span>
        <button
          type="button"
          className="page-sel-clear"
          title="Clear selection (Esc)"
          aria-label="Clear selection"
          onClick={() => usePageSelectionStore.getState().clearSelection()}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="page-sel-actions">
        {button("Rotate left", <RotateCcw size={14} aria-hidden="true" />, () =>
          actions.rotateSelectedPages(-90),
        )}
        {button("Rotate right", <RotateCw size={14} aria-hidden="true" />, () =>
          actions.rotateSelectedPages(90),
        )}
        {button(
          `Duplicate ${noun}`,
          <Copy size={14} aria-hidden="true" />,
          () => void runBusy(actions.duplicateSelectedPages),
        )}
        {button(
          "Add blank page after",
          <FilePlus size={14} aria-hidden="true" />,
          () => void runBusy(actions.insertBlankAfterSelection),
        )}
        {button(`Extract ${noun}…`, <FileOutput size={14} aria-hidden="true" />, () =>
          actions.openExtractDialog(),
        )}
        {button(`Export ${noun} as images…`, <ImageDown size={14} aria-hidden="true" />, () =>
          actions.openExportPageImages(),
        )}
        {button(`Replace ${noun}…`, <Replace size={14} aria-hidden="true" />, () =>
          actions.openReplaceDialog(),
        )}
        {button(
          all ? "Can't delete every page" : `Delete ${noun}`,
          <Trash2 size={14} aria-hidden="true" />,
          () => {
            const q = n === 1 ? "Delete this page?" : `Delete these ${n} pages?`;
            if (window.confirm(`${q} You can undo this.`)) actions.deleteSelectedPages();
          },
          "danger",
        )}
      </div>
    </div>
  );
}
