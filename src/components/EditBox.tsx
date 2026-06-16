import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { Trash2, ScanText, RefreshCw, GripVertical } from "lucide-react";
import type { PdfEdit } from "../store/useEditorStore";
import { useEditorStore, makeTextEdit, textToRuns } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { fileToDataUrl } from "../lib/file";
import { TextFormatToolbar } from "./TextFormatToolbar";
import { RichTextEditor } from "./RichTextEditor";

type SelectionRangeGetter = () => { start: number; end: number } | null;

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
  const addToast = useToastStore((s) => s.addToast);
  const ocrBusy = useEditorStore((s) => s.ocrBusy);
  const selected = useEditorStore((s) => s.selectedEditId === edit.id);
  const zoom = useEditorStore((s) => s.zoom);
  // The editor registers a selection-range getter here so the toolbar can apply
  // formatting to just the selected characters.
  const getSelectionRange = useRef<SelectionRangeGetter | null>(null);
  const [showComment, setShowComment] = useState(false);

  // Collapse the comment textarea when the box is deselected, so it doesn't
  // reappear the next time this box is selected.
  useEffect(() => {
    if (!selected) setShowComment(false);
  }, [selected]);

  /** Swap the picture of an image edit in place, keeping its box geometry. */
  function swapImage() {
    if (edit.type !== "image") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.style.display = "none";
    input.onchange = async () => {
      const picked = input.files?.[0];
      input.remove();
      if (!picked) return;
      try {
        const dataUrl = await fileToDataUrl(picked);
        updateEdit(edit.id, { dataUrl });
      } catch {
        addToast("Could not decode that image.", "error");
      }
    };
    // Safari/mobile block .click() on a detached input; mount it briefly.
    document.body.appendChild(input);
    input.click();
  }

  async function ocrImage() {
    if (edit.type !== "image") return;
    setOcrBusy(true);
    setOcrProgress(0);
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
            runs: textToRuns(it.str),
            fontSize: it.fontSize,
            fontFamily: it.fontFamily,
          }),
        );
      }
      addToast(items.length ? "Text recognized" : "No text found in this image", "info");
    } catch {
      addToast("Could not recognize text in this image.", "error");
    } finally {
      setOcrBusy(false);
      setOcrProgress(0);
    }
  }

  return (
    <Rnd
      size={{ width: edit.width, height: edit.height }}
      position={{ x: edit.x, y: edit.y }}
      // The page stage is CSS-scaled by `zoom`; tell Rnd so drag/resize deltas
      // map back to unscaled VIEWER_WIDTH coordinates.
      scale={zoom}
      bounds="parent"
      // Don't start a drag from inside any interactive child (editor, toolbar,
      // buttons, comment body), so text selection, typing, and clicks work. The
      // box still drags from its body (non-text types) and from the .drag-handle
      // — which is deliberately NOT cancelled, so it always initiates a move.
      cancel=".rich-text-editor, .text-format-toolbar, .delete, .comment-body, .comment-pin, .ocr-image-btn"
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
          <RichTextEditor
            edit={edit}
            selected={selected}
            onSelectionRef={(getter) => {
              getSelectionRange.current = getter;
            }}
          />
          {selected && (
            <TextFormatToolbar
              edit={edit}
              getSelectionRange={() => getSelectionRange.current?.() ?? null}
            />
          )}
        </>
      )}

      {edit.type === "image" && (
        <>
          <img src={edit.dataUrl} alt="" draggable={false} />
          {selected && (
            <div className="image-btn-row">
              <button
                type="button"
                className="ocr-image-btn"
                title="Recognize text in this image (OCR)"
                disabled={ocrBusy}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void ocrImage();
                }}
              >
                <ScanText size={14} aria-hidden="true" /> OCR
              </button>
              <button
                type="button"
                className="ocr-image-btn"
                title="Replace this image"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  swapImage();
                }}
              >
                <RefreshCw size={14} aria-hidden="true" /> Swap
              </button>
            </div>
          )}
        </>
      )}

      {edit.type === "rectangle" && <div className="rectangle-preview" />}

      {edit.type === "highlight" && (
        <div className="markup-preview highlight" style={{ background: edit.color }} />
      )}

      {edit.type === "underline" && (
        <div className="markup-preview underline" style={{ borderColor: edit.color }} />
      )}

      {edit.type === "strikeout" && (
        <div
          className="markup-preview strikeout"
          style={{ "--rule": edit.color } as React.CSSProperties}
        />
      )}

      {edit.type === "ink" && (
        <svg
          className="ink-preview"
          viewBox={`0 0 ${edit.width} ${edit.height}`}
          preserveAspectRatio="none"
        >
          <polyline
            points={edit.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={edit.color}
            strokeWidth={edit.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {edit.type === "comment" && (
        <>
          <button
            type="button"
            className="comment-pin"
            style={{ background: edit.color }}
            title={edit.text || "Comment"}
            aria-label={edit.text ? `Comment: ${edit.text}` : "Comment"}
            aria-expanded={showComment || selected}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowComment((v) => !v);
            }}
          />
          {(showComment || selected) && (
            <textarea
              className="comment-body"
              aria-label="Comment text"
              value={edit.text}
              placeholder="Add a comment…"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => updateEdit(edit.id, { text: e.target.value })}
            />
          )}
        </>
      )}

      {selected && (
        <button
          type="button"
          className="delete"
          title="Delete"
          aria-label="Delete this edit"
          // Stop pointer/mouse down from reaching react-rnd (drag) or the
          // re-resizable corner handle (resize) underneath, so the click lands.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            deleteEdit(edit.id);
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}

      {/* Visible grab handle: the primary move affordance for text boxes (whose
          body is reserved for editing) and an extra cue for other types. Not in
          the cancel list, so react-rnd starts a drag from it. */}
      <div className="drag-handle" aria-hidden="true" title="Move">
        <GripVertical size={14} />
      </div>
    </Rnd>
  );
}
