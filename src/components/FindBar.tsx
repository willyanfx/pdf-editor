import { useEffect, useRef, useState } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";

type Props = {
  onClose: () => void;
};

/**
 * Find-in-page over editable text. Matches are the ids of TextEdits whose text
 * contains the query (computed in the store). Enter / arrows step through matches,
 * scrolling each into view, selecting it, and jumping to its page.
 */
export function FindBar({ onClose }: Props) {
  const query = useEditorStore((s) => s.searchQuery);
  const matchIds = useEditorStore((s) => s.searchMatchIds);
  const setSearchQuery = useEditorStore((s) => s.setSearchQuery);
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  function go(delta: number) {
    if (matchIds.length === 0) return;
    const next = (cursor + delta + matchIds.length) % matchIds.length;
    setCursor(next);
    const id = matchIds[next];
    const store = useEditorStore.getState();
    const edit = store.edits.find((e) => e.id === id);
    if (edit) {
      selectEdit(id);
      store.scrollToPage?.(edit.pageIndex);
    }
  }

  return (
    <div className="find-bar" role="search">
      <Search size={14} className="find-icon" />
      <input
        ref={inputRef}
        className="find-input"
        type="text"
        aria-label="Find in page"
        placeholder="Find in page"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="find-count" aria-live="polite">
        {matchIds.length ? `${cursor + 1}/${matchIds.length}` : query ? "0/0" : ""}
      </span>
      <button
        type="button"
        title="Previous match"
        aria-label="Previous match"
        disabled={!matchIds.length}
        onClick={() => go(-1)}
      >
        <ChevronUp size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Next match"
        aria-label="Next match"
        disabled={!matchIds.length}
        onClick={() => go(1)}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Close find"
        aria-label="Close find"
        onClick={() => {
          setSearchQuery("");
          onClose();
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
