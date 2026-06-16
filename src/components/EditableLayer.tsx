import { useMemo } from "react";
import { useEditorStore } from "../store/useEditorStore";
import { EditBox } from "./EditBox";

type Props = {
  pageIndex: number;
};

export function EditableLayer({ pageIndex }: Props) {
  // Select the stable `edits` reference, then filter in the component body.
  // Filtering inside a zustand selector would build a new array on every
  // snapshot read and thrash re-renders under React 19's useSyncExternalStore.
  const allEdits = useEditorStore((s) => s.edits);
  const edits = useMemo(
    () => allEdits.filter((edit) => edit.pageIndex === pageIndex),
    [allEdits, pageIndex],
  );

  return (
    <div className="editable-layer">
      {/* Covers for existing-text edits stay pinned to the original glyph box,
          independent of where the editable box is dragged. */}
      {edits.map((edit) =>
        (edit.type === "text" || edit.type === "image") &&
        edit.origin === "existing" &&
        edit.coverRect ? (
          <div
            key={`cover-${edit.id}`}
            className="text-cover"
            style={{
              left: edit.coverRect.x,
              top: edit.coverRect.y,
              width: edit.coverRect.width,
              height: edit.coverRect.height,
              background: edit.coverColor,
            }}
          />
        ) : null,
      )}
      {edits.map((edit) => (
        <EditBox key={edit.id} edit={edit} />
      ))}
    </div>
  );
}
