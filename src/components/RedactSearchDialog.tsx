import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useEditorStore, type RedactEdit } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { PATTERNS, type PatternId } from "../lib/redactPatterns";
import type { ScreenTextItem } from "../lib/textLayer";
import {
  extractDocumentText,
  findRedactionMatches,
  type RedactionMatch,
} from "../lib/redactSearch";

/**
 * Search & redact: literal text (case-insensitive, optional whole-word) plus
 * built-in patterns, across every page. Each hit is listed with its page and a
 * snippet; "Mark selected" adds one redaction mark per selected hit (one undo
 * step). The document's text is extracted once per file and cached.
 */
export function RedactSearchDialog() {
  const open = useEditorStore((s) => s.redactSearchOpen);
  const file = useEditorStore((s) => s.file);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const addEdits = useEditorStore((s) => s.addEdits);
  const scrollToPage = useEditorStore((s) => s.scrollToPage);
  const addToast = useToastStore((s) => s.addToast);

  const [literal, setLiteral] = useState("");
  const [wholeWord, setWholeWord] = useState(false);
  const [patterns, setPatterns] = useState<Set<PatternId>>(() => new Set());
  const [matches, setMatches] = useState<RedactionMatch[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const cacheRef = useRef<{ file: File; blocks: Map<number, ScreenTextItem[]> } | null>(null);

  const onClose = () => useEditorStore.getState().setRedactSearchOpen(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  const hasQuery = literal.trim().length > 0 || patterns.size > 0;

  async function runSearch() {
    if (!file || !hasQuery) return;
    setBusy(true);
    try {
      let blocks = cacheRef.current?.file === file ? cacheRef.current.blocks : null;
      if (!blocks) {
        blocks = await extractDocumentText(file);
        cacheRef.current = { file, blocks };
      }
      const found = findRedactionMatches(
        blocks,
        useEditorStore.getState().edits,
        { literal, wholeWord, patterns: [...patterns] },
        pageOrder,
      );
      setMatches(found);
      setSelected(new Set(found.map((m) => m.id)));
    } catch {
      addToast("Could not search this document.", "error");
    } finally {
      setBusy(false);
    }
  }

  function togglePattern(id: PatternId, on: boolean) {
    setPatterns((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleMatch(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function markSelected() {
    if (!matches) return;
    const seen = new Set<string>();
    const marks: RedactEdit[] = [];
    for (const m of matches) {
      if (!selected.has(m.id)) continue;
      // Several hits in one overlay box all mark the same box — add it once.
      const key = `${m.pageIndex}:${m.rect.x},${m.rect.y},${m.rect.width},${m.rect.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      marks.push({ id: crypto.randomUUID(), type: "redact", pageIndex: m.pageIndex, ...m.rect });
    }
    if (marks.length === 0) return;
    addEdits(marks);
    addToast(
      `${marks.length} redaction mark${marks.length === 1 ? "" : "s"} added — applied when you download`,
      "success",
    );
    onClose();
  }

  const selectedCount = matches ? matches.filter((m) => selected.has(m.id)).length : 0;

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog redact-search"
        role="dialog"
        aria-modal="true"
        aria-label="Search and redact"
      >
        <div className="sig-header">
          <span>Search &amp; redact</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form
          className="redact-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <div className="redact-search-row">
            <input
              className="sig-type-input"
              aria-label="Text to find"
              placeholder="Text to find (optional)"
              value={literal}
              onChange={(e) => setLiteral(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button type="submit" className="sig-insert" disabled={busy || !hasQuery}>
              {busy ? "Searching…" : "Find"}
            </button>
          </div>
          <label className="redact-check">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
            />
            Whole words only
          </label>
          <fieldset className="redact-patterns">
            <legend className="ocr-menu-label">Also find</legend>
            {PATTERNS.map((p) => (
              <label key={p.id} className="redact-check" title={`e.g. ${p.example}`}>
                <input
                  type="checkbox"
                  checked={patterns.has(p.id)}
                  onChange={(e) => togglePattern(p.id, e.target.checked)}
                />
                {p.label}
              </label>
            ))}
          </fieldset>
        </form>

        <div className="redact-results-wrap" aria-live="polite">
          {matches === null ? (
            <p className="split-hint">
              Matches are listed here with their page. Tick the ones to redact, then mark them.
            </p>
          ) : matches.length === 0 ? (
            <p className="split-hint">No matches found.</p>
          ) : (
            <>
              <div className="redact-results-bar">
                <span>
                  {matches.length} match{matches.length === 1 ? "" : "es"}, {selectedCount} selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(new Set(matches.map((m) => m.id)))}
                >
                  All
                </button>
                <button type="button" onClick={() => setSelected(new Set())}>
                  None
                </button>
              </div>
              <ul className="redact-results">
                {matches.map((m) => (
                  <li key={m.id} className="redact-result">
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={(e) => toggleMatch(m.id, e.target.checked)}
                      />
                      <span className="redact-result-snippet">
                        {m.before}
                        <mark>{m.text}</mark>
                        {m.after}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="redact-result-page"
                      title="Show this page"
                      onClick={() => scrollToPage?.(m.pageIndex)}
                    >
                      p. {pageOrder.indexOf(m.pageIndex) + 1 || m.pageIndex + 1}
                    </button>
                    {m.source === "overlay" && (
                      <span
                        className="redact-result-tag"
                        title="This text is in an editable box; the whole box will be marked."
                      >
                        whole box
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sig-insert"
            disabled={selectedCount === 0}
            onClick={markSelected}
          >
            Mark selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </button>
        </div>
      </div>
    </>
  );
}
