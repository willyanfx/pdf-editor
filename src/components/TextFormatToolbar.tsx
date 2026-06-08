import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { FontFamily, TextEdit } from "../store/useEditorStore";
import { useEditorStore } from "../store/useEditorStore";

const FAMILIES: FontFamily[] = ["Helvetica", "Times", "Courier"];
const SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

type Props = {
  edit: TextEdit;
};

/** Floating formatting bar shown above a selected text box. */
export function TextFormatToolbar({ edit }: Props) {
  const updateEdit = useEditorStore((s) => s.updateEdit);

  return (
    <div
      className="text-format-toolbar"
      // Keep clicks here from bubbling to the page/deselecting.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={edit.fontFamily}
        title="Font"
        onChange={(e) => updateEdit(edit.id, { fontFamily: e.target.value as FontFamily })}
      >
        {FAMILIES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      <select
        value={edit.fontSize}
        title="Size"
        onChange={(e) => updateEdit(edit.id, { fontSize: Number(e.target.value) })}
      >
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={edit.bold ? "active" : ""}
        title="Bold"
        onClick={() => updateEdit(edit.id, { bold: !edit.bold })}
      >
        <Bold size={15} />
      </button>
      <button
        type="button"
        className={edit.italic ? "active" : ""}
        title="Italic"
        onClick={() => updateEdit(edit.id, { italic: !edit.italic })}
      >
        <Italic size={15} />
      </button>

      <span className="tft-divider" />

      <button
        type="button"
        className={edit.align === "left" ? "active" : ""}
        title="Align left"
        onClick={() => updateEdit(edit.id, { align: "left" })}
      >
        <AlignLeft size={15} />
      </button>
      <button
        type="button"
        className={edit.align === "center" ? "active" : ""}
        title="Align center"
        onClick={() => updateEdit(edit.id, { align: "center" })}
      >
        <AlignCenter size={15} />
      </button>
      <button
        type="button"
        className={edit.align === "right" ? "active" : ""}
        title="Align right"
        onClick={() => updateEdit(edit.id, { align: "right" })}
      >
        <AlignRight size={15} />
      </button>

      <span className="tft-divider" />

      <label className="tft-color" title="Text color">
        <input
          type="color"
          value={edit.color}
          onChange={(e) => updateEdit(edit.id, { color: e.target.value })}
        />
      </label>
    </div>
  );
}

/** Map our family + weight/style choice to a CSS font stack for on-screen rendering. */
export function cssFontStack(family: FontFamily): string {
  switch (family) {
    case "Times":
      return '"Times New Roman", Times, serif';
    case "Courier":
      return '"Courier New", Courier, monospace';
    default:
      return "Helvetica, Arial, sans-serif";
  }
}
