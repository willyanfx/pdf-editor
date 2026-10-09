import { useState, type ReactNode } from "react";
import {
  Circle,
  Cloud,
  Minus,
  MoveUpRight,
  Pentagon,
  Shapes,
  Square,
  Stamp,
  X,
} from "lucide-react";
import { useEditorStore, type EditorMode } from "../store/useEditorStore";
import { useCommentsUiStore } from "../store/useCommentsUiStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { STAMP_PRESETS } from "../lib/annotations";
import { RailButton } from "./RailButton";

const SHAPES: { mode: EditorMode; label: string; icon: ReactNode }[] = [
  { mode: "line", label: "Line", icon: <Minus size={16} /> },
  { mode: "arrow", label: "Arrow", icon: <MoveUpRight size={16} /> },
  { mode: "rectangle", label: "Rectangle", icon: <Square size={16} /> },
  { mode: "oval", label: "Oval", icon: <Circle size={16} /> },
  { mode: "polygon", label: "Polygon", icon: <Pentagon size={16} /> },
  { mode: "cloud", label: "Cloud", icon: <Cloud size={16} /> },
];

const SHAPE_MODES = new Set<EditorMode>([...SHAPES.map((s) => s.mode), "stamp"]);

const HINT: Partial<Record<EditorMode, string>> = {
  line: "Drag to draw. Hold Shift to snap to 45°.",
  arrow: "Drag to draw. Hold Shift to snap to 45°.",
  rectangle: "Drag to draw a rectangle.",
  oval: "Drag to draw an oval.",
  cloud: "Drag to draw a revision cloud.",
  polygon: "Click each corner. Double-click, click the first point or press Enter to finish.",
  stamp: "Click to place the stamp, or drag to size it.",
};

/**
 * Tool-rail entry for the shape and stamp annotations. A popover (same pattern
 * as the OCR and redact menus) picks the shape or stamp and arms the tool; the
 * drawing itself happens in ShapeLayer / AnnotateLayer.
 */
export function ShapesMenu() {
  const [open, setOpen] = useState(false);
  const file = useEditorStore((s) => s.file);
  const mode = useEditorStore((s) => s.mode);
  const stampId = useCommentsUiStore((s) => s.stampId);
  const setStampId = useCommentsUiStore((s) => s.setStampId);
  const { setMode } = useEditorActions();

  const close = () => setOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, close);

  return (
    <div className="ocr-menu-anchor">
      <RailButton
        icon={<Shapes size={18} />}
        tip="Shapes & stamps"
        active={open || SHAPE_MODES.has(mode)}
        toggle
        disabled={!file}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      />

      {open && (
        <>
          <div className="palette-backdrop" style={{ background: "transparent" }} onClick={close} />
          <div
            ref={trapRef}
            className="ocr-menu-popover shapes-menu"
            role="dialog"
            aria-modal="false"
            aria-label="Shapes and stamps"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sig-header">
              <span>
                <Shapes size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                Shapes &amp; stamps
              </span>
              <button type="button" className="sig-close" onClick={close} aria-label="Close menu">
                <X size={16} />
              </button>
            </div>

            <span className="ocr-menu-label">Shapes</span>
            <div className="shapes-grid">
              {SHAPES.map((s) => (
                <button
                  key={s.mode}
                  type="button"
                  className={"shape-btn" + (mode === s.mode ? " active" : "")}
                  aria-pressed={mode === s.mode}
                  onClick={() => {
                    setMode(s.mode);
                    close();
                  }}
                >
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>

            <div className="ocr-menu-divider" />

            <span className="ocr-menu-label">
              <Stamp size={11} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
              Stamps
            </span>
            <div className="stamp-grid" role="group" aria-label="Choose a stamp">
              {STAMP_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={"stamp-chip" + (mode === "stamp" && stampId === p.id ? " active" : "")}
                  style={{ ["--stamp" as string]: p.color }}
                  onClick={() => {
                    setStampId(p.id);
                    setMode("stamp");
                    close();
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <p className="ocr-menu-hint">
              {(HINT[mode] as string | undefined) ??
                "Pick a shape or stamp, then place it on the page."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
