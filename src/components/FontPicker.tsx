import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import type { FontFamily } from "../store/useEditorStore";
import {
  STANDARD_FAMILIES,
  GOOGLE_FONTS,
  type FontCategory,
  cssFontFamily,
  ensureFontLoaded,
} from "../lib/fonts";

// ---------------------------------------------------------------------------
// Category display labels
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<FontCategory, string> = {
  "sans-serif": "Sans-serif",
  serif: "Serif",
  display: "Display",
  handwriting: "Handwriting",
  monospace: "Monospace",
};

// ---------------------------------------------------------------------------
// Flat list of all options for filtering
// ---------------------------------------------------------------------------

type FontOption = {
  family: FontFamily;
  group: "Standard" | FontCategory;
};

const ALL_OPTIONS: FontOption[] = [
  ...STANDARD_FAMILIES.map((f) => ({ family: f, group: "Standard" as const })),
  ...GOOGLE_FONTS.map((e) => ({ family: e.family, group: e.category })),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupLabel(group: FontOption["group"]): string {
  if (group === "Standard") return "Standard (built-in)";
  return CATEGORY_LABEL[group];
}

// ---------------------------------------------------------------------------
// Lazy preview: inject font CSS only for visible options.
// We batch injections in a requestAnimationFrame so rapid keyboard nav does
// not fire 100 link injections in one tick.
// ---------------------------------------------------------------------------

let _pendingInject: Set<FontFamily> | null = null;

function scheduleInject(family: FontFamily): void {
  if (!_pendingInject) {
    _pendingInject = new Set();
    requestAnimationFrame(() => {
      const batch = _pendingInject!;
      _pendingInject = null;
      for (const f of batch) ensureFontLoaded(f);
    });
  }
  _pendingInject.add(family);
}

// ---------------------------------------------------------------------------
// FontPicker component
// ---------------------------------------------------------------------------

export type FontPickerProps = {
  value: FontFamily;
  onChange: (family: FontFamily) => void;
};

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Index into the filtered flat list (across groups) for keyboard nav.
  const [activeIdx, setActiveIdx] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filtered flat option list.
  const filtered: FontOption[] = query.trim()
    ? ALL_OPTIONS.filter((o) => o.family.toLowerCase().includes(query.trim().toLowerCase()))
    : ALL_OPTIONS;

  // Open the popup.
  const openPicker = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIdx(-1);
  }, []);

  // Close the popup and restore focus to the trigger button.
  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIdx(-1);
    // Restore focus so keyboard users don't lose their place.
    triggerRef.current?.focus();
  }, []);

  // Select a font and close.
  const selectFont = useCallback(
    (family: FontFamily) => {
      onChange(family);
      closePicker();
    },
    [onChange, closePicker],
  );

  // Ensure the currently selected font is loaded so the trigger button renders
  // in the correct face without a flash of unstyled text.
  useEffect(() => {
    ensureFontLoaded(value);
  }, [value]);

  // Focus search input when popup opens.
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    }
  }, [open]);

  // Reset activeIdx when filter changes.
  useEffect(() => {
    setActiveIdx(-1);
  }, [query]);

  // Scroll active item into view.
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });

    // Lazy-load preview for active item.
    const opt = filtered[activeIdx];
    if (opt) scheduleInject(opt.family);
  }, [activeIdx, filtered]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        closePicker();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closePicker]);

  // Keyboard navigation on the search input.
  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Only select if an item is explicitly highlighted via arrow keys.
      // Silently selecting filtered[0] with no visual affordance is confusing.
      const opt = activeIdx >= 0 ? filtered[activeIdx] : undefined;
      if (opt) selectFont(opt.family);
      return;
    }
  };

  // Build rendered list with group headers.
  const rows: Array<
    | { kind: "header"; label: string; key: string }
    | { kind: "option"; option: FontOption; idx: number }
  > = [];

  if (filtered.length === 0) {
    // Empty — rendered separately below.
  } else if (query.trim()) {
    // Flat list when searching.
    filtered.forEach((opt, idx) => {
      rows.push({ kind: "option", option: opt, idx });
    });
  } else {
    // Grouped list when not searching.
    let lastGroup: FontOption["group"] | null = null;
    filtered.forEach((opt, idx) => {
      if (opt.group !== lastGroup) {
        lastGroup = opt.group;
        rows.push({
          kind: "header",
          label: groupLabel(opt.group),
          key: `header-${opt.group}`,
        });
      }
      rows.push({ kind: "option", option: opt, idx });
    });
  }

  return (
    <div
      className="fp-container"
      ref={containerRef}
      // Stop toolbar's own stopPropagation chain from swallowing our clicks.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        className="fp-trigger"
        title="Font family"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ fontFamily: cssFontFamily(value) }}
        onMouseDown={(e) => {
          // Prevent mousedown from stealing focus away from the editor.
          e.preventDefault();
        }}
        onClick={() => {
          if (open) {
            closePicker();
          } else {
            openPicker();
          }
        }}
      >
        <span className="fp-trigger-label">{value}</span>
        <span className="fp-trigger-arrow" aria-hidden="true">
          &#9660;
        </span>
      </button>

      {/* Popup */}
      {open && (
        <div className="fp-popup" role="dialog" aria-label="Choose font family">
          {/* Search */}
          <div className="fp-search-wrap">
            <input
              ref={searchRef}
              role="combobox"
              type="search"
              className="fp-search"
              placeholder="Search fonts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-autocomplete="list"
              aria-controls="fp-list"
              aria-expanded={true}
              aria-activedescendant={activeIdx >= 0 ? `fp-opt-${activeIdx}` : undefined}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* Options list */}
          <ul
            id="fp-list"
            ref={listRef}
            role="listbox"
            aria-label="Font families"
            className="fp-list"
          >
            {filtered.length === 0 && (
              <li className="fp-empty" role="option" aria-disabled="true">
                No fonts match "{query}"
              </li>
            )}

            {rows.map((row) => {
              if (row.kind === "header") {
                return (
                  <li
                    key={row.key}
                    className="fp-group-label"
                    role="presentation"
                    aria-hidden="true"
                  >
                    {row.label}
                  </li>
                );
              }

              const { option, idx } = row;
              const isSelected = option.family === value;
              const isActive = idx === activeIdx;

              return (
                <li
                  key={option.family}
                  id={`fp-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  data-idx={idx}
                  className={[
                    "fp-option",
                    isSelected ? "fp-option--selected" : "",
                    isActive ? "fp-option--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ fontFamily: cssFontFamily(option.family) }}
                  onMouseEnter={() => {
                    setActiveIdx(idx);
                    scheduleInject(option.family);
                  }}
                  onMouseDown={(e) => {
                    // Prevent search input from losing focus before the click fires.
                    e.preventDefault();
                  }}
                  onClick={() => selectFont(option.family)}
                >
                  {option.family}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
