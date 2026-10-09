import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useEditorStore, type StandardFontFamily } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { usePageStampsUi } from "../store/usePageStampsUi";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { STANDARD_FAMILIES } from "../lib/fonts";
import {
  formatBates,
  formatStampDate,
  hasUnprintableChars,
  HEADER_FOOTER_PRESETS,
  HEADER_FOOTER_SLOTS,
  parseStampRange,
  STAMP_TOKENS,
  type HeaderFooterSettings,
  type HeaderFooterSlot,
  type StampDateFormat,
  type StampPageRange,
  type WatermarkSettings,
} from "../lib/pageStampsModel";

/** Mounted once in App; renders whichever stamps dialog is open. */
export function PageStampsDialogs() {
  const dialog = usePageStampsUi((s) => s.dialog);
  const file = useEditorStore((s) => s.file);

  // A different document invalidates the draft — close rather than apply it there.
  const firstFile = useRef(file);
  useEffect(() => {
    if (file !== firstFile.current) usePageStampsUi.getState().close();
    firstFile.current = file;
  }, [file]);

  if (dialog === "headerFooter") return <HeaderFooterDialog />;
  if (dialog === "watermark") return <WatermarkDialog />;
  return null;
}

const SLOT_LABELS: Record<HeaderFooterSlot, string> = {
  topLeft: "Header left",
  topCenter: "Header center",
  topRight: "Header right",
  bottomLeft: "Footer left",
  bottomCenter: "Footer center",
  bottomRight: "Footer right",
};

const DATE_FORMATS: { value: StampDateFormat; label: string }[] = [
  { value: "iso", label: "2026-01-31" },
  { value: "us", label: "01/31/2026" },
  { value: "eu", label: "31/01/2026" },
  { value: "long", label: "January 31, 2026" },
];

/** A number input that can be cleared and retyped freely: the setting only
 * changes when the text parses, clamped to [min, max]; blur shows the result. */
function NumberField({
  value,
  min,
  max,
  integer = false,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  integer?: boolean;
  label?: string;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      className="stamp-input stamp-num"
      min={min}
      max={max}
      aria-label={label}
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number.parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, integer ? Math.round(n) : n)));
      }}
      onBlur={() => setText(null)}
    />
  );
}

function useOutputPageCount() {
  return useEditorStore((s) => s.pageOrder.length || s.numPages);
}

/** Shell shared by both dialogs: a non-modal side panel so the live preview on
 * the pages stays visible (and scrollable) while settings change. */
function StampDialogShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);
  return (
    <div
      ref={trapRef}
      className="split-dialog stamp-dialog"
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      <div className="sig-header">
        <span>{title}</span>
        <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <p className="split-hint">The preview updates on the pages as you change settings.</p>
      {children}
      <div className="sig-actions">{footer}</div>
    </div>
  );
}

/** All / odd / even / custom page picker shared by both dialogs. */
function PageRangeField({
  range,
  custom,
  total,
  onChange,
}: {
  range: StampPageRange;
  custom: string;
  total: number;
  onChange: (range: StampPageRange, custom: string) => void;
}) {
  const id = useId();
  const noMatch = range === "custom" && parseStampRange(custom, total).size === 0;
  return (
    <div className="stamp-section">
      <span className="stamp-label">Pages</span>
      <div className="stamp-row">
        <select
          className="stamp-input"
          aria-label="Which pages"
          value={range}
          onChange={(e) => onChange(e.target.value as StampPageRange, custom)}
        >
          <option value="all">All pages</option>
          <option value="odd">Odd pages</option>
          <option value="even">Even pages</option>
          <option value="custom">Custom…</option>
        </select>
        {range === "custom" && (
          <input
            className="stamp-input stamp-grow"
            aria-label="Custom pages"
            aria-describedby={`${id}-hint`}
            aria-invalid={noMatch || undefined}
            placeholder="e.g. 1-3, 7"
            value={custom}
            onChange={(e) => onChange(range, e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </div>
      {range === "custom" && (
        <p id={`${id}-hint`} className={noMatch ? "stamp-error" : "stamp-note"}>
          {noMatch
            ? `No pages match — use numbers from 1 to ${total}.`
            : "Page numbers as they’ll appear in the downloaded file."}
        </p>
      )}
    </div>
  );
}

function FontFields({
  font,
  size,
  color,
  sizeMax,
  onChange,
  children,
}: {
  font: StandardFontFamily;
  size: number;
  color: string;
  sizeMax: number;
  onChange: (p: { font?: StandardFontFamily; fontSize?: number; color?: string }) => void;
  children?: ReactNode;
}) {
  return (
    <div className="stamp-row">
      <select
        className="stamp-input"
        aria-label="Font"
        value={font}
        onChange={(e) => onChange({ font: e.target.value as StandardFontFamily })}
      >
        {STANDARD_FAMILIES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <label>
        Size
        <NumberField
          value={size}
          min={4}
          max={sizeMax}
          onChange={(fontSize) => onChange({ fontSize })}
        />
        pt
      </label>
      <label>
        Color
        <input
          type="color"
          className="stamp-color"
          value={color}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </label>
      {children}
    </div>
  );
}

function HeaderFooterDialog() {
  const draft = usePageStampsUi((s) => s.headerFooterDraft);
  const setDraft = usePageStampsUi((s) => s.setHeaderFooterDraft);
  const close = usePageStampsUi((s) => s.close);
  const applied = useEditorStore((s) => s.pageStamps.headerFooter);
  const total = useOutputPageCount();
  const fileName = useEditorStore((s) => s.file?.name ?? "");
  const inputs = useRef<Partial<Record<HeaderFooterSlot, HTMLInputElement | null>>>({});
  const lastSlot = useRef<HeaderFooterSlot>("bottomCenter");

  if (!draft) return null;
  const d = draft;

  const patch = (p: Partial<HeaderFooterSettings>) => setDraft({ ...d, ...p });
  const setSlot = (slot: HeaderFooterSlot, text: string) =>
    patch({ slots: { ...d.slots, [slot]: text } });

  /** Insert a token at the caret of the last-focused slot. */
  function insertToken(token: string) {
    const slot = lastSlot.current;
    const el = inputs.current[slot];
    const value = d.slots[slot];
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setSlot(slot, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const isEmpty = HEADER_FOOTER_SLOTS.every((s) => !d.slots[s].trim());
  const rangeEmpty = d.pageRange === "custom" && parseStampRange(d.customRange, total).size === 0;
  const uses = (token: RegExp) => HEADER_FOOTER_SLOTS.some((s) => token.test(d.slots[s]));
  const usesBates = uses(/\{bates\}/i);
  const unprintable =
    HEADER_FOOTER_SLOTS.some((s) => hasUnprintableChars(d.slots[s])) ||
    (usesBates && hasUnprintableChars(d.bates.prefix + d.bates.suffix)) ||
    (uses(/\{filename\}/i) && hasUnprintableChars(fileName));

  function remove() {
    useEditorStore.getState().setHeaderFooter(null);
    useToastStore.getState().addToast("Header & footer removed", "info");
    close();
  }

  function apply() {
    // Clearing every field and applying is the same as removing.
    if (isEmpty) return remove();
    useEditorStore.getState().setHeaderFooter(structuredClone(d));
    useToastStore.getState().addToast("Header & footer applied", "success");
    close();
  }

  return (
    <StampDialogShell
      title="Header & footer"
      onClose={close}
      footer={
        <>
          {applied && (
            <button type="button" className="sig-cancel stamp-remove" onClick={remove}>
              Remove
            </button>
          )}
          <button type="button" className="sig-cancel" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="sig-insert"
            onClick={apply}
            disabled={rangeEmpty || (isEmpty && !applied)}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="stamp-section">
        <span className="stamp-label">Quick add</span>
        <div className="stamp-chips">
          {HEADER_FOOTER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="stamp-chip"
              title={`Puts “${p.text}” in the ${SLOT_LABELS[p.slot].toLowerCase()}`}
              onClick={() => setSlot(p.slot, p.text)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stamp-section">
        <div className="stamp-slots">
          <span />
          <span className="stamp-col">Left</span>
          <span className="stamp-col">Center</span>
          <span className="stamp-col">Right</span>
          {(["top", "bottom"] as const).map((row) => (
            <SlotRow
              key={row}
              row={row}
              slots={d.slots}
              inputs={inputs.current}
              onFocus={(slot) => (lastSlot.current = slot)}
              onChange={setSlot}
            />
          ))}
        </div>
        <div
          className="stamp-chips stamp-tokens"
          role="group"
          aria-label="Insert into the last field you used"
        >
          <span className="stamp-note">Insert:</span>
          {STAMP_TOKENS.map((t) => (
            <button
              key={t}
              type="button"
              className="stamp-chip stamp-token"
              // Keep focus (and the caret) in the slot input.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertToken(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {unprintable && (
          <p className="stamp-error">
            Some characters aren’t available in the standard fonts and will print as “?”.
          </p>
        )}
      </div>

      <div className="stamp-section">
        <span className="stamp-label">Text</span>
        <FontFields
          font={d.font}
          size={d.fontSize}
          color={d.color}
          sizeMax={72}
          onChange={(p) => patch(p)}
        />
      </div>

      <div className="stamp-section">
        <span className="stamp-label">Distance from edge (pt)</span>
        <div className="stamp-row">
          {(["top", "bottom", "left", "right"] as const).map((edge) => (
            <label key={edge}>
              {edge[0].toUpperCase() + edge.slice(1)}
              <NumberField
                value={d.margins[edge]}
                min={0}
                max={360}
                onChange={(n) => patch({ margins: { ...d.margins, [edge]: n } })}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="stamp-section">
        <span className="stamp-label">Numbers &amp; date</span>
        <div className="stamp-row">
          <label>
            First page number
            <NumberField
              value={d.startNumber}
              min={0}
              max={1e9}
              integer
              onChange={(startNumber) => patch({ startNumber })}
            />
          </label>
          <label>
            Date
            <select
              className="stamp-input"
              value={d.dateFormat}
              onChange={(e) => patch({ dateFormat: e.target.value as StampDateFormat })}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="stamp-note">
          Today: {formatStampDate(new Date(), d.dateFormat)}. Numbers follow the page order of the
          downloaded file.
        </p>
      </div>

      <details className="stamp-section stamp-details" open={usesBates}>
        <summary className="stamp-label">Bates numbering</summary>
        <div className="stamp-row">
          <label>
            Prefix
            <input
              className="stamp-input stamp-short"
              value={d.bates.prefix}
              onChange={(e) => patch({ bates: { ...d.bates, prefix: e.target.value } })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Start
            <NumberField
              value={d.bates.start}
              min={0}
              max={1e12}
              integer
              onChange={(start) => patch({ bates: { ...d.bates, start } })}
            />
          </label>
          <label>
            Digits
            <NumberField
              value={d.bates.digits}
              min={1}
              max={12}
              integer
              onChange={(digits) => patch({ bates: { ...d.bates, digits } })}
            />
          </label>
          <label>
            Suffix
            <input
              className="stamp-input stamp-short"
              value={d.bates.suffix}
              onChange={(e) => patch({ bates: { ...d.bates, suffix: e.target.value } })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
        <p className="stamp-note">
          First page: <strong>{formatBates(d.bates, 0)}</strong>
          {usesBates ? "" : " — add {bates} to a field above to show it."}
        </p>
      </details>

      <PageRangeField
        range={d.pageRange}
        custom={d.customRange}
        total={total}
        onChange={(pageRange, customRange) => patch({ pageRange, customRange })}
      />
    </StampDialogShell>
  );
}

function SlotRow({
  row,
  slots,
  inputs,
  onFocus,
  onChange,
}: {
  row: "top" | "bottom";
  slots: Record<HeaderFooterSlot, string>;
  inputs: Partial<Record<HeaderFooterSlot, HTMLInputElement | null>>;
  onFocus: (slot: HeaderFooterSlot) => void;
  onChange: (slot: HeaderFooterSlot, text: string) => void;
}) {
  const keys: HeaderFooterSlot[] =
    row === "top"
      ? ["topLeft", "topCenter", "topRight"]
      : ["bottomLeft", "bottomCenter", "bottomRight"];
  return (
    <>
      <span className="stamp-col">{row === "top" ? "Header" : "Footer"}</span>
      {keys.map((slot) => (
        <input
          key={slot}
          ref={(el) => {
            inputs[slot] = el;
          }}
          className="stamp-input"
          aria-label={SLOT_LABELS[slot]}
          value={slots[slot]}
          onFocus={() => onFocus(slot)}
          onChange={(e) => onChange(slot, e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      ))}
    </>
  );
}

const ROTATION_PRESETS = [
  { label: "Diagonal", value: 45 },
  { label: "Flat", value: 0 },
  { label: "Upward", value: 90 },
];

function WatermarkDialog() {
  const draft = usePageStampsUi((s) => s.watermarkDraft);
  const setDraft = usePageStampsUi((s) => s.setWatermarkDraft);
  const close = usePageStampsUi((s) => s.close);
  const applied = useEditorStore((s) => s.pageStamps.watermark);
  const total = useOutputPageCount();
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!draft) return null;
  const d = draft;
  const patch = (p: Partial<WatermarkSettings>) => setDraft({ ...d, ...p });

  const isEmpty = d.source === "image" ? !d.imageDataUrl : !d.text.trim();
  const rangeEmpty = d.pageRange === "custom" && parseStampRange(d.customRange, total).size === 0;

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      useToastStore.getState().addToast("Choose a PNG or JPEG image.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // Read the latest draft: the user may have changed settings meanwhile.
      const latest = usePageStampsUi.getState().watermarkDraft;
      if (latest && typeof reader.result === "string") {
        setDraft({ ...latest, source: "image", imageDataUrl: reader.result });
      }
    };
    reader.onerror = () => useToastStore.getState().addToast("Could not read that image.", "error");
    reader.readAsDataURL(file);
  }

  function apply() {
    useEditorStore.getState().setWatermark(structuredClone(d));
    useToastStore.getState().addToast("Watermark applied", "success");
    close();
  }

  function remove() {
    useEditorStore.getState().setWatermark(null);
    useToastStore.getState().addToast("Watermark removed", "info");
    close();
  }

  return (
    <StampDialogShell
      title="Watermark"
      onClose={close}
      footer={
        <>
          {applied && (
            <button type="button" className="sig-cancel stamp-remove" onClick={remove}>
              Remove
            </button>
          )}
          <button type="button" className="sig-cancel" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="sig-insert"
            onClick={apply}
            disabled={isEmpty || rangeEmpty}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="sig-tabs" role="tablist" aria-label="Watermark type">
        {(["text", "image"] as const).map((src) => (
          <button
            key={src}
            type="button"
            role="tab"
            aria-selected={d.source === src}
            className={d.source === src ? "active" : ""}
            onClick={() => patch({ source: src })}
          >
            {src === "text" ? "Text" : "Image"}
          </button>
        ))}
      </div>

      {d.source === "text" ? (
        <div className="stamp-section" role="tabpanel" aria-label="Text watermark">
          <input
            className="sig-type-input stamp-wm-text"
            aria-label="Watermark text"
            value={d.text}
            onChange={(e) => patch({ text: e.target.value })}
            autoComplete="off"
            autoFocus
          />
          {hasUnprintableChars(d.text) && (
            <p className="stamp-error">
              Some characters aren’t available in the standard fonts and will print as “?”.
            </p>
          )}
          <FontFields
            font={d.font}
            size={d.fontSize}
            color={d.color}
            sizeMax={400}
            onChange={(p) => patch(p)}
          >
            <label>
              <input
                type="checkbox"
                checked={d.bold}
                onChange={(e) => patch({ bold: e.target.checked })}
              />
              Bold
            </label>
          </FontFields>
        </div>
      ) : (
        <div className="stamp-section" role="tabpanel" aria-label="Image watermark">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => {
              pickImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="stamp-row">
            {d.imageDataUrl && <img className="stamp-thumb" src={d.imageDataUrl} alt="" />}
            <button type="button" className="sig-cancel" onClick={() => fileRef.current?.click()}>
              {d.imageDataUrl ? "Change image…" : "Choose image…"}
            </button>
          </div>
          <label className="stamp-slider">
            <span>Size: {Math.round(d.imageScale * 100)}% of page</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(d.imageScale * 100)}
              onChange={(e) => patch({ imageScale: Number.parseInt(e.target.value, 10) / 100 })}
            />
          </label>
        </div>
      )}

      <div className="stamp-section">
        <label className="stamp-slider">
          <span>Opacity: {Math.round(d.opacity * 100)}%</span>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={Math.round(d.opacity * 100)}
            onChange={(e) => patch({ opacity: Number.parseInt(e.target.value, 10) / 100 })}
          />
        </label>
      </div>

      <div className="stamp-section">
        <span className="stamp-label">Angle</span>
        <div className="stamp-row">
          {ROTATION_PRESETS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={d.rotation === r.value ? "stamp-chip active" : "stamp-chip"}
              aria-pressed={d.rotation === r.value}
              onClick={() => patch({ rotation: r.value })}
            >
              {r.label}
            </button>
          ))}
          <label>
            <NumberField
              value={d.rotation}
              min={-180}
              max={180}
              integer
              label="Angle in degrees"
              onChange={(rotation) => patch({ rotation })}
            />
            °
          </label>
        </div>
      </div>

      <PageRangeField
        range={d.pageRange}
        custom={d.customRange}
        total={total}
        onChange={(pageRange, customRange) => patch({ pageRange, customRange })}
      />
    </StampDialogShell>
  );
}
