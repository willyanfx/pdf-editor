import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FilePlus2,
  MousePointer2,
  Pencil,
  ScanLine,
  Type,
  ImagePlus,
  Square,
  ScanText,
  Download,
} from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";

type Props = {
  onClose: () => void;
};

type PaletteAction = {
  id: string;
  group: "File" | "Mode" | "Add" | "Export";
  label: string;
  icon: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
};

const GROUP_ORDER: PaletteAction["group"][] = ["File", "Mode", "Add", "Export"];

/** In-house command palette (no cmdk dependency). Opened with ⌘K from App. */
export function CommandPalette({ onClose }: Props) {
  const file = useEditorStore((s) => s.file);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const actions = useEditorActions();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const noFile = !file;

  // Run an action then close. Defined once so every item shares the behavior.
  function runAndClose(fn: () => void) {
    fn();
    onClose();
  }

  const allActions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "open",
        group: "File",
        label: "Open PDF",
        icon: <FilePlus2 size={16} />,
        run: () => runAndClose(actions.pickPdf),
      },
      {
        id: "mode-select",
        group: "Mode",
        label: "Select",
        icon: <MousePointer2 size={16} />,
        shortcut: "V",
        disabled: noFile,
        run: () => runAndClose(() => actions.setMode("select")),
      },
      {
        id: "mode-edit",
        group: "Mode",
        label: "Edit Text",
        icon: <Pencil size={16} />,
        shortcut: "E",
        disabled: noFile,
        run: () => runAndClose(() => actions.setMode("editText")),
      },
      {
        id: "mode-ocr",
        group: "Mode",
        label: "OCR Region",
        icon: <ScanLine size={16} />,
        disabled: noFile || ocrBusy,
        run: () => runAndClose(() => actions.setMode("ocr")),
      },
      {
        id: "add-text",
        group: "Add",
        label: "Add Text",
        icon: <Type size={16} />,
        shortcut: "T",
        disabled: noFile,
        run: () => runAndClose(actions.addText),
      },
      {
        id: "add-image",
        group: "Add",
        label: "Add Image / Signature",
        icon: <ImagePlus size={16} />,
        disabled: noFile,
        run: () => runAndClose(actions.pickImage),
      },
      {
        id: "add-box",
        group: "Add",
        label: "Add Box",
        icon: <Square size={16} />,
        disabled: noFile,
        run: () => runAndClose(actions.addRectangle),
      },
      {
        id: "extract",
        group: "Export",
        label: "Extract Text (OCR page)",
        icon: <ScanText size={16} />,
        disabled: noFile || ocrBusy,
        run: () => runAndClose(actions.extractText),
      },
      {
        id: "download",
        group: "Export",
        label: "Download PDF",
        icon: <Download size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => void actions.downloadPdf()),
      },
    ],
    // actions is recreated each render but its handlers read the store at call
    // time, so the static list is fine to memoize on the reactive inputs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noFile, ocrBusy],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allActions;
    return allActions.filter((a) => a.label.toLowerCase().includes(q));
  }, [query, allActions]);

  // Keep the highlighted row in range whenever the filtered list shrinks.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[activeIndex];
      if (action && !action.disabled) action.run();
    }
  }

  // Group the filtered results, preserving GROUP_ORDER, and track the flat index
  // so keyboard highlighting lines up across groups.
  let flatIndex = -1;

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">No matching commands</div>}
          {GROUP_ORDER.map((group) => {
            const items = filtered.filter((a) => a.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <div className="palette-group-label">{group}</div>
                {items.map((action) => {
                  flatIndex += 1;
                  const isActive = flatIndex === activeIndex;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className={isActive ? "palette-item active" : "palette-item"}
                      disabled={action.disabled}
                      onClick={action.run}
                      onMouseMove={() => setActiveIndex(filtered.indexOf(action))}
                    >
                      <span className="palette-item-icon">{action.icon}</span>
                      <span className="palette-item-label">{action.label}</span>
                      {action.shortcut && (
                        <span className="palette-item-shortcut">{action.shortcut}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
