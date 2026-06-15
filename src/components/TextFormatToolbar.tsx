import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { TextEdit, TextRun } from "../store/useEditorStore";
import { useEditorStore } from "../store/useEditorStore";
import { applyFormatToRange } from "../lib/richText";
import { FontPicker } from "./FontPicker";
export { cssFontStack } from "../lib/fonts";

const SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

type Props = {
  edit: TextEdit;
  /** Reads the current character selection inside the editor, or null. */
  getSelectionRange?: () => { start: number; end: number } | null;
};

/** Floating formatting bar shown above a selected text box. */
export function TextFormatToolbar({ edit, getSelectionRange }: Props) {
  const updateEdit = useEditorStore((s) => s.updateEdit);

  /** Apply a run-style patch: to the selected character range if there is one,
   * otherwise to the whole box (both the box default and every run, so existing
   * per-run overrides don't shadow the new value). */
  function applyRunStyle(patch: Partial<TextRun>, boxPatch: Partial<TextEdit>) {
    const range = getSelectionRange?.();
    if (range && range.end > range.start) {
      updateEdit(edit.id, { runs: applyFormatToRange(edit.runs, range.start, range.end, patch) });
    } else {
      const runs = edit.runs.map((r) => ({ ...r, ...patch }));
      updateEdit(edit.id, { ...boxPatch, runs });
    }
  }

  /** True if every run in the selection (or box) has the given style on. */
  function isActive(key: keyof TextRun, boxValue: boolean): boolean {
    const range = getSelectionRange?.();
    if (!range || range.end <= range.start) return boxValue;
    // Walk runs over the range; active only if all covered runs have it true.
    let pos = 0;
    let all = true;
    let any = false;
    for (const r of edit.runs) {
      const start = pos;
      const end = pos + r.text.length;
      pos = end;
      if (end <= range.start || start >= range.end) continue;
      any = true;
      if (!(r[key] ?? boxValue)) all = false;
    }
    return any ? all : boxValue;
  }

  return (
    <div
      className="text-format-toolbar"
      // Keep clicks here from bubbling to the page/deselecting.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <FontPicker
        value={edit.fontFamily}
        onChange={(f) => updateEdit(edit.id, { fontFamily: f })}
      />

      <select
        value={edit.fontSize}
        title="Size"
        onChange={(e) => {
          const size = Number(e.target.value);
          applyRunStyle({ fontSize: size }, { fontSize: size });
        }}
      >
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={isActive("bold", edit.bold) ? "active" : ""}
        title="Bold"
        // Don't steal focus from the editor, so its selection stays live and the
        // formatted range can be re-highlighted after the runs update.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyRunStyle({ bold: !isActive("bold", edit.bold) }, { bold: !edit.bold })}
      >
        <Bold size={15} />
      </button>
      <button
        type="button"
        className={isActive("italic", edit.italic) ? "active" : ""}
        title="Italic"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          applyRunStyle({ italic: !isActive("italic", edit.italic) }, { italic: !edit.italic })
        }
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
          onChange={(e) => applyRunStyle({ color: e.target.value }, { color: e.target.value })}
        />
      </label>
    </div>
  );
}

