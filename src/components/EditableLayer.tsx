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
      {edits.map((edit) => (
        <EditBox key={edit.id} edit={edit} />
      ))}
    </div>
  );
}
