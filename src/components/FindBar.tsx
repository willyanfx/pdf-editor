import { useEffect, useRef, useState } from "react";
import { Search, ChevronUp, ChevronDown, X, CaseSensitive, WholeWord } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";

type Props = {
  onClose: () => void;
};

/**
 * Find-in-page over editable text. Matches are the ids of TextEdits whose text
 * contains the query (computed in the store), optionally case-sensitive and/or
 * whole-word. Enter / arrows step through matches, scrolling each into view,
 * selecting it, and jumping to its page.
 */
export function FindBar({ onClose }: Props) {
  const query = useEditorStore((s) => s.searchQuery);
  const matchIds = useEditorStore((s) => s.searchMatchIds);
  const setSearchQuery = useEditorStore((s) => s.setSearchQuery);
  const caseSensitive = useEditorStore((s) => s.searchCaseSensitive);
  const wholeWord = useEditorStore((s) => s.searchWholeWord);
  const setSearchOptions = useEditorStore((s) => s.setSearchOptions);
  const selectEdit = useEditorStore((s) => s.selectEdit);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cursor, setCursor] = useState(0);
  // Mirror cursor so rapid Enter presses step from the latest value, not the one
  // captured when go() was created for the current render.
  const cursorRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    cursorRef.current = 0;
    setCursor(0);
  }, [query, caseSensitive, wholeWord]);

  function close() {
    // Clear the query so stale matches don't linger in the store after closing.
    setSearchQuery("");
    onClose();
  }

  function go(delta: number) {
    if (matchIds.length === 0) return;
    const next = (cursorRef.current + delta + matchIds.length) % matchIds.length;
    cursorRef.current = next;
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
            close();
          } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyC") {
            // e.code, not e.key: Option+letter types a different character on macOS.
            e.preventDefault();
            setSearchOptions({ caseSensitive: !caseSensitive });
          } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyW") {
            e.preventDefault();
            setSearchOptions({ wholeWord: !wholeWord });
          }
        }}
      />
      <button
        type="button"
        className={"find-toggle" + (caseSensitive ? " active" : "")}
        title="Match case (Alt+C)"
        aria-label="Match case"
        aria-pressed={caseSensitive}
        onClick={() => setSearchOptions({ caseSensitive: !caseSensitive })}
      >
        <CaseSensitive size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={"find-toggle" + (wholeWord ? " active" : "")}
        title="Whole words only (Alt+W)"
        aria-label="Whole words only"
        aria-pressed={wholeWord}
        onClick={() => setSearchOptions({ wholeWord: !wholeWord })}
      >
        <WholeWord size={15} aria-hidden="true" />
      </button>
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
      <button type="button" title="Close find" aria-label="Close find" onClick={close}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
