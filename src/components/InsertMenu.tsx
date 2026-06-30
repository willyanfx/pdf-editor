import { useEffect, useRef } from "react";
import { FilePlus2, ImagePlus, FileText, Plus } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { CONVERTIBLE_ACCEPT } from "../lib/convertToPdf";
import type { InsertSource } from "../lib/pageInsert";

/** Open a transient file picker; resolve with the chosen file(s). */
function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}

type Props = {
  /** 0-based insertion slot in pageOrder (0 = before first, pageOrder.length = after last). */
  position: number;
  onClose: () => void;
};

/**
 * Small popover menu rendered near an insert gap in the PagePanel.
 * Presents four insert options and delegates to the store's insertPages action.
 */
export function InsertMenu({ position, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Move focus to the first menu item on mount.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
  }, []);

  async function insert(sources: InsertSource[]) {
    onClose();
    const store = useEditorStore.getState();
    if (!store.insertPages) return; // guard against parallel build not yet merged
    const toast = useToastStore.getState();
    try {
      await store.insertPages(sources, position);
      toast.addToast("Pages inserted", "success");
    } catch {
      toast.addToast("Could not insert pages.", "error");
    }
  }

  function pickPdfs() {
    void pickFiles("application/pdf", true).then((files) => {
      if (!files.length) return;
      void insert(files.map((file) => ({ kind: "pdf" as const, file })));
    });
  }

  function pickImages() {
    void pickFiles("image/png,image/jpeg", true).then((files) => {
      if (!files.length) return;
      void insert(files.map((file) => ({ kind: "convert" as const, file })));
    });
  }

  function pickOffice() {
    void pickFiles(CONVERTIBLE_ACCEPT, true).then((files) => {
      if (!files.length) return;
      void insert(files.map((file) => ({ kind: "convert" as const, file })));
    });
  }

  function insertBlank() {
    void insert([{ kind: "blank", size: "letter" }]);
  }

  return (
    <div
      ref={menuRef}
      className="insert-menu"
      role="menu"
      aria-label="Insert pages"
      /* Trap Tab within the menu. */
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <button type="button" role="menuitem" className="insert-menu-item" onClick={pickPdfs}>
        <FilePlus2 size={14} aria-hidden="true" />
        PDF…
      </button>
      <button type="button" role="menuitem" className="insert-menu-item" onClick={pickImages}>
        <ImagePlus size={14} aria-hidden="true" />
        Image…
      </button>
      <button type="button" role="menuitem" className="insert-menu-item" onClick={pickOffice}>
        <FileText size={14} aria-hidden="true" />
        Word / Excel…
      </button>
      <button type="button" role="menuitem" className="insert-menu-item" onClick={insertBlank}>
        <Plus size={14} aria-hidden="true" />
        Blank page
      </button>
    </div>
  );
}
