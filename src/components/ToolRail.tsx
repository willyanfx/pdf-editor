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
  Highlighter,
  Underline,
  MessageSquare,
  PenTool,
  Signature,
  Files,
  FileInput,
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
  onTogglePages: () => void;
  pagesActive: boolean;
};

export function ToolRail({ onOpenPalette, onTogglePages, pagesActive }: Props) {
  const file = useEditorStore((s) => s.file);
  const mode = useEditorStore((s) => s.mode);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const { setMode, addText, pickImage, addRectangle, extractText, openSignature, convertFile } =
    useEditorActions();

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
      {modeBtn("editText", <Pencil size={18} />, "Edit Text / Image (E)")}
      {modeBtn("ocr", <ScanLine size={18} />, "OCR Region", ocrBusy)}

      <span className="rail-divider" />

      <RailButton icon={<Type size={18} />} tip="Add Text (T)" disabled={noFile} onClick={addText} />
      <RailButton
        icon={<ImagePlus size={18} />}
        tip="Add Image"
        disabled={noFile}
        onClick={pickImage}
      />
      <RailButton
        icon={<Signature size={18} />}
        tip="Sign (draw / type)"
        disabled={noFile}
        onClick={openSignature}
      />
      <RailButton icon={<Square size={18} />} tip="Add Box" disabled={noFile} onClick={addRectangle} />

      <span className="rail-divider" />

      {modeBtn("highlight", <Highlighter size={18} />, "Highlight (H)")}
      {modeBtn("underline", <Underline size={18} />, "Underline (U)")}
      {modeBtn("comment", <MessageSquare size={18} />, "Comment (C)")}
      {modeBtn("ink", <PenTool size={18} />, "Draw (D)")}

      <span className="rail-divider" />

      <RailButton
        icon={<Files size={18} />}
        tip="Organize pages"
        active={pagesActive}
        disabled={noFile}
        onClick={onTogglePages}
      />
      <RailButton
        icon={<ScanText size={18} />}
        tip="Extract Text (OCR page)"
        disabled={noFile || ocrBusy}
        onClick={extractText}
      />
      <RailButton
        icon={<FileInput size={18} />}
        tip="Convert file to PDF"
        onClick={convertFile}
      />

      <span className="rail-spacer" />

      <RailButton icon={<Command size={18} />} tip="Command palette (⌘K)" onClick={onOpenPalette} />
    </nav>
  );
}
