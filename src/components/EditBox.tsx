import { Rnd } from "react-rnd";
import { X } from "lucide-react";
import type { PdfEdit } from "../store/useEditorStore";
import { useEditorStore } from "../store/useEditorStore";

type Props = {
  edit: PdfEdit;
};

export function EditBox({ edit }: Props) {
  const updateEdit = useEditorStore((s) => s.updateEdit);
  const deleteEdit = useEditorStore((s) => s.deleteEdit);
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const selected = useEditorStore((s) => s.selectedEditId === edit.id);

  return (
    <Rnd
      size={{ width: edit.width, height: edit.height }}
      position={{ x: edit.x, y: edit.y }}
      bounds="parent"
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
        <textarea
          value={edit.text}
          style={{ fontSize: edit.fontSize }}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(event) =>
            updateEdit(edit.id, { text: event.target.value })
          }
        />
      )}

      {edit.type === "image" && (
        <img src={edit.dataUrl} alt="" draggable={false} />
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
