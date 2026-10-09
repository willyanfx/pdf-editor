import type { ReactNode } from "react";
import {
  MousePointer2,
  Hand,
  Pencil,
  Type,
  ImagePlus,
  Square,
  Command,
  Highlighter,
  Underline,
  MessageSquare,
  PenTool,
  Strikethrough,
  MessagesSquare,
  Signature,
  Files,
  FileInput,
  FilePlus,
} from "lucide-react";
import { useEditorStore, type EditorMode } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { RailButton } from "./RailButton";
import { OcrMenu } from "./OcrMenu";
import { StampsMenu } from "./StampsMenu";
import { RedactMenu } from "./RedactMenu";
import { ShapesMenu } from "./ShapesMenu";

type Props = {
  onOpenPalette: () => void;
  onTogglePages: () => void;
  pagesActive: boolean;
};

export function ToolRail({ onOpenPalette, onTogglePages, pagesActive }: Props) {
  const file = useEditorStore((s) => s.file);
  const mode = useEditorStore((s) => s.mode);
  const { setMode, pickImage, addRectangle, openSignature, convertFile, addPages, showComments } =
    useEditorActions();

  const noFile = !file;

  function modeBtn(value: EditorMode, icon: ReactNode, tip: string, disabled = false) {
    return (
      <RailButton
        icon={icon}
        tip={tip}
        active={mode === value}
        toggle
        disabled={noFile || disabled}
        onClick={() => setMode(value)}
      />
    );
  }

  return (
    <nav className="tool-rail" aria-label="Editing tools">
      {modeBtn("select", <MousePointer2 size={18} />, "Select (V)")}
      {modeBtn("hand", <Hand size={18} />, "Hand tool — drag to pan (hold Space)")}
      {modeBtn("editText", <Pencil size={18} />, "Edit Text / Image (E)")}

      {/* Single OCR entry point — engine choice + scope actions in a popover. */}
      <OcrMenu />

      <span className="rail-divider" />

      {modeBtn("addText", <Type size={18} />, "Add Text — draw a box (T)")}
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
      <RailButton
        icon={<Square size={18} />}
        tip="Add Box"
        disabled={noFile}
        onClick={addRectangle}
      />

      <span className="rail-divider" />

      {modeBtn("highlight", <Highlighter size={18} />, "Highlight (H)")}
      {modeBtn("underline", <Underline size={18} />, "Underline (U)")}
      {modeBtn("strikeout", <Strikethrough size={18} />, "Strikeout (S)")}
      {modeBtn("comment", <MessageSquare size={18} />, "Comment (C)")}
      {modeBtn("ink", <PenTool size={18} />, "Draw (D)")}
      {/* Line, arrow, rectangle, oval, polygon, cloud and stamps in a popover. */}
      <ShapesMenu />
      {/* Redaction: marking tool, search dialog, preview toggle in a popover. */}
      <RedactMenu />

      <span className="rail-divider" />

      <RailButton
        icon={<Files size={18} />}
        tip="Organize pages"
        active={pagesActive}
        toggle
        disabled={noFile}
        onClick={onTogglePages}
      />
      <RailButton
        icon={<FilePlus size={18} />}
        tip="Add / combine pages…"
        disabled={noFile}
        onClick={addPages}
      />
      <StampsMenu />
      <RailButton icon={<FileInput size={18} />} tip="Convert file to PDF" onClick={convertFile} />

      <span className="rail-spacer" />

      <RailButton
        icon={<MessagesSquare size={18} />}
        tip="Comments panel"
        disabled={noFile}
        onClick={() => showComments()}
      />
      <RailButton icon={<Command size={18} />} tip="Command palette (⌘K)" onClick={onOpenPalette} />
    </nav>
  );
}
