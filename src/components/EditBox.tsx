import { Rnd } from "react-rnd";
import { X, ScanText } from "lucide-react";
import type { PdfEdit } from "../store/useEditorStore";
import { useEditorStore, makeTextEdit } from "../store/useEditorStore";
import { TextFormatToolbar, cssFontStack } from "./TextFormatToolbar";

type Props = {
  edit: PdfEdit;
};

export function EditBox({ edit }: Props) {
  const updateEdit = useEditorStore((s) => s.updateEdit);
  const deleteEdit = useEditorStore((s) => s.deleteEdit);
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const addEdit = useEditorStore((s) => s.addEdit);
  const setOcrBusy = useEditorStore((s) => s.setOcrBusy);
  const setOcrProgress = useEditorStore((s) => s.setOcrProgress);
  const setErrorMessage = useEditorStore((s) => s.setErrorMessage);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const selected = useEditorStore((s) => s.selectedEditId === edit.id);

  async function ocrImage() {
    if (edit.type !== "image") return;
    setOcrBusy(true);
    setOcrProgress(0);
    setErrorMessage(null);
    try {
      const { recognizeImageDataUrl } = await import("../lib/ocr");
      const items = await recognizeImageDataUrl(
        edit.dataUrl,
        { x: edit.x, y: edit.y, width: edit.width, height: edit.height },
        setOcrProgress,
      );
      for (const it of items) {
        // Lay recognized text over the image without covering it — the user may
        // want to keep the original signature/photo intact.
        addEdit(
          makeTextEdit({
            pageIndex: edit.pageIndex,
            x: it.x,
            y: it.y,
            width: Math.max(it.width + 8, 40),
            height: Math.max(it.height, 16),
            text: it.str,
            fontSize: it.fontSize,
            fontFamily: it.fontFamily,
          }),
        );
      }
    } catch {
      setErrorMessage("Could not recognize text in this image.");
    } finally {
      setOcrBusy(false);
      setOcrProgress(0);
    }
  }

  return (
    <Rnd
      size={{ width: edit.width, height: edit.height }}
      position={{ x: edit.x, y: edit.y }}
      bounds="parent"
      // Don't start a drag from inside the textarea/toolbar, so text selection
      // and typing work; the box still drags from its border/handles.
      cancel="textarea, .text-format-toolbar, .delete"
      onMouseDown={(event) => {
        event.stopPropagation();
        selectEdit(edit.id);
      }}
      onDragStop={(_event, data) => {
        updateEdit(edit.id, { x: data.x, y: data.y });
      }}
      onResizeStop={(_event, _dir, ref, _delta, position) => {
        updateEdit(edit.id, {
          width: Number.parseFloat(ref.style.width),
          height: Number.parseFloat(ref.style.height),
          x: position.x,
          y: position.y,
        });
      }}
      className={selected ? "edit-box selected" : "edit-box"}
    >
      {edit.type === "text" && (
        <>
          {/* The cover for the original glyphs is rendered by EditableLayer,
              pinned to the original location so it stays put when this box moves. */}
          <textarea
            value={edit.text}
            spellCheck={false}
            style={{
              fontSize: edit.fontSize,
              fontFamily: cssFontStack(edit.fontFamily),
              fontWeight: edit.bold ? 700 : 400,
              fontStyle: edit.italic ? "italic" : "normal",
              color: edit.color,
              textAlign: edit.align,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(event) => updateEdit(edit.id, { text: event.target.value })}
          />
          {selected && <TextFormatToolbar edit={edit} />}
        </>
      )}

      {edit.type === "image" && (
        <>
          <img src={edit.dataUrl} alt="" draggable={false} />
          {selected && (
            <button
              className="ocr-image-btn"
              title="Recognize text in this image (OCR)"
              disabled={ocrBusy}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void ocrImage();
              }}
            >
              <ScanText size={14} /> OCR
            </button>
          )}
        </>
      )}

      {edit.type === "rectangle" && <div className="rectangle-preview" />}

      {selected && (
        <button
          className="delete"
          title="Delete"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            deleteEdit(edit.id);
          }}
        >
          <X size={14} />
        </button>
      )}
    </Rnd>
  );
}
