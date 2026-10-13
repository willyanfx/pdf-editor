import type { ReactNode } from "react";
import {
  Circle,
  Cloud,
  EyeOff,
  Hand,
  Highlighter,
  MessageSquare,
  Minus,
  MoveUpRight,
  Pencil,
  PenTool,
  Pentagon,
  ScanText,
  Signature,
  Square,
  Stamp,
  Strikethrough,
  Type,
  Underline,
} from "lucide-react";
import { useEditorStore, type EditorMode } from "../store/useEditorStore";

type ToolInfo = { name: string; hint: string; icon: ReactNode };

const ICON = 16;

/** What each tool is called and how to use it, for every mode except Select. */
const TOOLS: Record<Exclude<EditorMode, "select">, ToolInfo> = {
  hand: { name: "Hand", hint: "Drag to pan the document", icon: <Hand size={ICON} /> },
  editText: {
    name: "Edit text & images",
    hint: "Click existing text or an image to change it",
    icon: <Pencil size={ICON} />,
  },
  ocr: {
    name: "OCR region",
    hint: "Drag a box around text to make it editable",
    icon: <ScanText size={ICON} />,
  },
  addText: { name: "Add text", hint: "Drag to draw a text box", icon: <Type size={ICON} /> },
  highlight: {
    name: "Highlight",
    hint: "Drag across text to highlight it",
    icon: <Highlighter size={ICON} />,
  },
  underline: {
    name: "Underline",
    hint: "Drag across text to underline it",
    icon: <Underline size={ICON} />,
  },
  strikeout: {
    name: "Strikeout",
    hint: "Drag across text to strike it out",
    icon: <Strikethrough size={ICON} />,
  },
  comment: {
    name: "Comment",
    hint: "Click where the note should go",
    icon: <MessageSquare size={ICON} />,
  },
  ink: { name: "Draw", hint: "Draw freehand on the page", icon: <PenTool size={ICON} /> },
  line: { name: "Line", hint: "Drag to draw a line", icon: <Minus size={ICON} /> },
  arrow: { name: "Arrow", hint: "Drag to draw an arrow", icon: <MoveUpRight size={ICON} /> },
  rectangle: { name: "Rectangle", hint: "Drag to draw a rectangle", icon: <Square size={ICON} /> },
  oval: { name: "Oval", hint: "Drag to draw an oval", icon: <Circle size={ICON} /> },
  polygon: {
    name: "Polygon",
    hint: "Click to add points · Enter to finish",
    icon: <Pentagon size={ICON} />,
  },
  cloud: { name: "Cloud", hint: "Drag to draw a cloud", icon: <Cloud size={ICON} /> },
  stamp: {
    name: "Stamp",
    hint: "Click to place it, or drag to size it",
    icon: <Stamp size={ICON} />,
  },
  signZones: {
    name: "Sign",
    hint: "Click a highlighted spot to sign there",
    icon: <Signature size={ICON} />,
  },
  redact: {
    name: "Redact",
    hint: "Drag across text or an area to mark it for redaction",
    icon: <EyeOff size={ICON} />,
  },
};

/**
 * The active-tool bar: while any tool other than Select is on, name it, say
 * how to use it, and offer a visible way back (Done, or Esc). Without it the
 * only cue for a sticky mode is a tinted rail icon.
 */
export function ToolHint() {
  const file = useEditorStore((s) => s.file);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);

  if (!file || mode === "select") return null;
  const tool = TOOLS[mode];

  return (
    <div className="tool-hint" role="status" aria-live="polite">
      <span className="tool-hint-icon" aria-hidden="true">
        {tool.icon}
      </span>
      <span className="tool-hint-name">{tool.name}</span>
      <span className="tool-hint-text">{tool.hint}</span>
      <button type="button" className="tool-hint-done" onClick={() => setMode("select")}>
        Done <kbd>Esc</kbd>
      </button>
    </div>
  );
}
