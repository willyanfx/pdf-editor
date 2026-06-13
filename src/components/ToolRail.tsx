import type { ReactNode } from "react";
import {
  MousePointer2,
  Pencil,
  ScanLine,
  Type,
  ImagePlus,
  Square,
  ScanText,
  Command,
} from "lucide-react";
import { useEditorStore, type EditorMode } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";

type RailButtonProps = {
  icon: ReactNode;
  tip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

function RailButton({ icon, tip, active, disabled, onClick }: RailButtonProps) {
  return (
    <button
      type="button"
      className={active ? "rail-btn active" : "rail-btn"}
      data-tip={tip}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

type Props = {
  onOpenPalette: () => void;
};

export function ToolRail({ onOpenPalette }: Props) {
  const file = useEditorStore((s) => s.file);
  const mode = useEditorStore((s) => s.mode);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const { setMode, addText, pickImage, addRectangle, extractText } = useEditorActions();

  const noFile = !file;

  function modeBtn(value: EditorMode, icon: ReactNode, tip: string, disabled = false) {
    return (
      <RailButton
        icon={icon}
        tip={tip}
        active={mode === value}
        disabled={noFile || disabled}
        onClick={() => setMode(value)}
      />
    );
  }

  return (
    <nav className="tool-rail" aria-label="Editing tools">
      {modeBtn("select", <MousePointer2 size={18} />, "Select (V)")}
      {modeBtn("editText", <Pencil size={18} />, "Edit Text (E)")}
      {modeBtn("ocr", <ScanLine size={18} />, "OCR Region", ocrBusy)}

      <span className="rail-divider" />

      <RailButton icon={<Type size={18} />} tip="Add Text (T)" disabled={noFile} onClick={addText} />
      <RailButton
        icon={<ImagePlus size={18} />}
        tip="Add Image / Signature"
        disabled={noFile}
        onClick={pickImage}
      />
      <RailButton
        icon={<Square size={18} />}
        tip="Add Box"
        disabled={noFile}
        onClick={addRectangle}
      />

      <span className="rail-divider" />

      <RailButton
        icon={<ScanText size={18} />}
        tip="Extract Text (OCR page)"
        disabled={noFile || ocrBusy}
        onClick={extractText}
      />

      <span className="rail-spacer" />

      <RailButton
        icon={<Command size={18} />}
        tip="Command palette (⌘K)"
        onClick={onOpenPalette}
      />
    </nav>
  );
}
