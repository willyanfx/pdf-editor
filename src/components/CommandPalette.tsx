import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FilePlus2,
  Link2,
  MousePointer2,
  Pencil,
  ScanLine,
  Type,
  ImagePlus,
  Square,
  ScanText,
  ScanSearch,
  FileText,
  Download,
  Highlighter,
  Underline,
  MessageSquare,
  PenTool,
  Signature,
  FileInput,
  Combine,
  Scissors,
  Minimize2,
  Table2,
  Info,
  RotateCw,
  Trash2,
  MoveHorizontal,
  Maximize,
} from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";

type Props = {
  onClose: () => void;
};

type PaletteAction = {
  id: string;
  group: "File" | "Mode" | "Add" | "Annotate" | "Pages" | "View" | "Export";
  label: string;
  icon: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
};

const GROUP_ORDER: PaletteAction["group"][] = [
  "File",
  "Mode",
  "Add",
  "Annotate",
  "Pages",
  "View",
  "Export",
];

/** In-house command palette (no cmdk dependency). Opened with ⌘K from App. */
export function CommandPalette({ onClose }: Props) {
  const file = useEditorStore((s) => s.file);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const actions = useEditorActions();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);

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
        id: "open-url",
        group: "File",
        label: "Open PDF from URL…",
        icon: <Link2 size={16} />,
        run: () => runAndClose(actions.openUrlDialog),
      },
      {
        id: "convert",
        group: "File",
        label: "Convert file to PDF…",
        icon: <FileInput size={16} />,
        run: () => runAndClose(actions.convertFile),
      },
      {
        id: "merge",
        group: "File",
        label: "Merge PDFs…",
        icon: <Combine size={16} />,
        run: () => runAndClose(actions.mergePdfs),
      },
      {
        id: "split",
        group: "File",
        label: "Split PDF…",
        icon: <Scissors size={16} />,
        disabled: noFile,
        run: () => runAndClose(actions.openSplit),
      },
      {
        id: "metadata",
        group: "File",
        label: "Document properties…",
        icon: <Info size={16} />,
        disabled: noFile,
        run: () => runAndClose(actions.openMetadata),
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
        run: () => runAndClose(() => actions.setMode("addText")),
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
        id: "add-signature",
        group: "Add",
        label: "Sign (draw / type)…",
        icon: <Signature size={16} />,
        disabled: noFile,
        run: () => runAndClose(actions.openSignature),
      },
      {
        id: "find-signature-zones",
        group: "Add",
        label: "Find signature spots",
        icon: <Signature size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => actions.setMode("signZones")),
      },
      {
        id: "ann-highlight",
        group: "Annotate",
        label: "Highlight",
        icon: <Highlighter size={16} />,
        shortcut: "H",
        disabled: noFile,
        run: () => runAndClose(() => actions.setMode("highlight")),
      },
      {
        id: "ann-underline",
        group: "Annotate",
        label: "Underline",
        icon: <Underline size={16} />,
        shortcut: "U",
        disabled: noFile,
        run: () => runAndClose(() => actions.setMode("underline")),
      },
      {
        id: "ann-comment",
        group: "Annotate",
        label: "Add Comment",
        icon: <MessageSquare size={16} />,
        shortcut: "C",
        disabled: noFile,
        run: () => runAndClose(() => actions.setMode("comment")),
      },
      {
        id: "ann-ink",
        group: "Annotate",
        label: "Draw (freehand)",
        icon: <PenTool size={16} />,
        shortcut: "D",
        disabled: noFile,
        run: () => runAndClose(() => actions.setMode("ink")),
      },
      {
        id: "page-rotate",
        group: "Pages",
        label: "Rotate Page Clockwise",
        icon: <RotateCw size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => actions.rotatePage(90)),
      },
      {
        id: "page-delete",
        group: "Pages",
        label: "Delete Current Page",
        icon: <Trash2 size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => actions.deletePage()),
      },
      {
        id: "fit-width",
        group: "View",
        label: "Zoom: Fit Width",
        icon: <MoveHorizontal size={16} />,
        shortcut: "W",
        disabled: noFile,
        run: () => runAndClose(() => useEditorStore.getState().setZoomPreset("fit-width")),
      },
      {
        id: "fit-page",
        group: "View",
        label: "Zoom: Fit Page",
        icon: <Maximize size={16} />,
        shortcut: "P",
        disabled: noFile,
        run: () => runAndClose(() => useEditorStore.getState().setZoomPreset("fit-page")),
      },
      {
        id: "zoom-reset",
        group: "View",
        label: "Zoom: Reset to 100%",
        icon: <Maximize size={16} />,
        shortcut: "⌘0",
        disabled: noFile,
        run: () => runAndClose(() => useEditorStore.getState().resetZoom()),
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
        id: "extract-all",
        group: "Export",
        label: "Extract Text (OCR all pages)",
        icon: <ScanSearch size={16} />,
        disabled: noFile || ocrBusy,
        run: () => runAndClose(actions.extractAllPages),
      },
      {
        id: "download",
        group: "Export",
        label: "Download PDF",
        icon: <Download size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => void actions.downloadPdf()),
      },
      {
        id: "download-docx",
        group: "Export",
        label: "Export DOCX (formatted)",
        icon: <FileText size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => void actions.downloadDocx()),
      },
      {
        id: "export-csv",
        group: "Export",
        label: "Export text as CSV",
        icon: <Table2 size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => void actions.downloadCsv()),
      },
      {
        id: "compress",
        group: "Export",
        label: "Compress PDF",
        icon: <Minimize2 size={16} />,
        disabled: noFile,
        run: () => runAndClose(() => void actions.compressPdf()),
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
      <div
        ref={trapRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls="palette-listbox"
          aria-activedescendant={filtered.length ? `palette-opt-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" id="palette-listbox" role="listbox" aria-label="Commands">
          {filtered.length === 0 && <div className="palette-empty">No matching commands</div>}
          {GROUP_ORDER.map((group) => {
            const items = filtered.filter((a) => a.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} role="group" aria-label={group}>
                <div className="palette-group-label" role="presentation">
                  {group}
                </div>
                {items.map((action) => {
                  flatIndex += 1;
                  const isActive = flatIndex === activeIndex;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      id={`palette-opt-${flatIndex}`}
                      role="option"
                      aria-selected={isActive}
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
