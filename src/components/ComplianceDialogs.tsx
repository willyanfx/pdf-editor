import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Eye, TriangleAlert } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { usePageSelectionStore } from "../store/usePageSelectionStore";
import { useExportToolsUi } from "../store/useExportToolsUi";
import { useEditorActions, type PageScope } from "../hooks/useEditorActions";
import { inVisibleOrder } from "../lib/pageRemap";
import {
  DEFAULT_BOOKLET,
  DEFAULT_NUP,
  PAGES_PER_SHEET,
  SHEET_SIZES,
  layoutSheetCount,
  type BookletOptions,
  type NUpOptions,
  type SheetSize,
} from "../lib/printLayout";
import {
  LANGUAGE_TAG,
  type A11yCheck,
  type A11yReport,
  type A11yStatus,
} from "../lib/accessibility";
import type { PdfaIssue } from "../lib/pdfa";
import { DialogShell, ScopeChoice, initialScope } from "./ToolDialogShell";

const close = () => useExportToolsUi.getState().close();

/** Cancel + primary action, the footer every tool dialog shares. */
function Actions({
  busy,
  disabled,
  action,
  busyLabel,
  onAction,
  cancelLabel = "Cancel",
}: {
  busy: boolean;
  disabled?: boolean;
  action: string;
  busyLabel: string;
  onAction: () => void;
  cancelLabel?: string;
}) {
  return (
    <div className="sig-actions">
      <button type="button" className="sig-cancel" onClick={close} disabled={busy}>
        {cancelLabel}
      </button>
      <button type="button" className="sig-insert" onClick={onAction} disabled={busy || disabled}>
        {busy ? busyLabel : action}
      </button>
    </div>
  );
}

const SHEET_OPTIONS = (Object.keys(SHEET_SIZES) as SheetSize[]).map((key) => ({
  value: key,
  label: SHEET_SIZES[key].label,
}));

const MARGINS = [
  { value: 0, label: "None" },
  { value: 18, label: "Small" },
  { value: 36, label: "Medium" },
];

/** How many pages the chosen scope covers, for the sheet-count summary. */
function useScopeCount(scope: PageScope): number {
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const numPages = useEditorStore((s) => s.numPages);
  const selected = usePageSelectionStore((s) => s.selected);
  if (scope === "current") return 1;
  if (scope === "selected") return inVisibleOrder(pageOrder, selected).length;
  return pageOrder.length || numPages;
}

// ---------------------------------------------------------------------------

type LayoutMode = "nup" | "booklet";

/** Pages-per-sheet and booklet printing layouts. */
export function PrintLayoutDialog() {
  const { exportPrintLayout } = useEditorActions();
  const [mode, setMode] = useState<LayoutMode>("nup");
  const [scope, setScope] = useState<PageScope>(initialScope);
  const [nup, setNup] = useState<NUpOptions>(DEFAULT_NUP);
  const [booklet, setBooklet] = useState<BookletOptions>(DEFAULT_BOOKLET);
  const [busy, setBusy] = useState(false);

  const options = mode === "nup" ? nup : booklet;
  const count = useScopeCount(scope);
  const sheets = count > 0 ? layoutSheetCount(count, options) : 0;

  const submit = async () => {
    setBusy(true);
    try {
      if (await exportPrintLayout(options, scope)) close();
    } finally {
      setBusy(false);
    }
  };

  const sheetSelect = (value: SheetSize, onChange: (v: SheetSize) => void) => (
    <label className="export-opt">
      Paper size
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SheetSize)}
        disabled={busy}
        aria-label="Paper size"
      >
        {SHEET_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const marginSelect = (value: number, onChange: (v: number) => void) => (
    <label className="export-opt">
      Margins
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={busy}
        aria-label="Margins"
      >
        {MARGINS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <DialogShell title="Print layout" busy={busy}>
      <p className="split-hint">
        Builds a new PDF with your edits applied, ready to print. Comments and form fields are drawn
        into the pages; links are not kept.
      </p>
      <div className="sig-tabs" role="tablist" aria-label="Layout">
        {(
          [
            ["nup", "Pages per sheet"],
            ["booklet", "Booklet"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? "active" : ""}
            onClick={() => setMode(value)}
            disabled={busy}
          >
            {label}
          </button>
        ))}
      </div>
      <ScopeChoice scope={scope} onChange={setScope} disabled={busy} />
      {mode === "nup" ? (
        <>
          <label className="export-opt">
            Pages per sheet
            <select
              value={nup.perSheet}
              onChange={(e) =>
                setNup({ ...nup, perSheet: Number(e.target.value) as NUpOptions["perSheet"] })
              }
              disabled={busy}
              aria-label="Pages per sheet"
            >
              {PAGES_PER_SHEET.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {sheetSelect(nup.sheet, (sheet) => setNup({ ...nup, sheet }))}
          <label className="export-opt">
            Orientation
            <select
              value={nup.orientation}
              onChange={(e) =>
                setNup({ ...nup, orientation: e.target.value as NUpOptions["orientation"] })
              }
              disabled={busy}
              aria-label="Orientation"
            >
              <option value="auto">Automatic (largest pages)</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label className="export-opt">
            Page order
            <select
              value={nup.order}
              onChange={(e) => setNup({ ...nup, order: e.target.value as NUpOptions["order"] })}
              disabled={busy}
              aria-label="Page order"
            >
              <option value="rows">Across, then down</option>
              <option value="columns">Down, then across</option>
            </select>
          </label>
          {marginSelect(nup.margin, (margin) => setNup({ ...nup, margin }))}
          <label className="export-opt">
            <input
              type="checkbox"
              checked={nup.border}
              onChange={(e) => setNup({ ...nup, border: e.target.checked })}
              disabled={busy}
            />
            Draw a border around each page
          </label>
        </>
      ) : (
        <>
          <p className="split-hint">
            Orders the pages so a double-sided print, folded in half, reads in sequence. The page
            count is rounded up to a multiple of four with blank pages.
          </p>
          {sheetSelect(booklet.sheet, (sheet) => setBooklet({ ...booklet, sheet }))}
          <label className="export-opt">
            Binding
            <select
              value={booklet.rightToLeft ? "right" : "left"}
              onChange={(e) => setBooklet({ ...booklet, rightToLeft: e.target.value === "right" })}
              disabled={busy}
              aria-label="Binding"
            >
              <option value="left">Left edge (most languages)</option>
              <option value="right">Right edge (right-to-left)</option>
            </select>
          </label>
          {marginSelect(booklet.margin, (margin) => setBooklet({ ...booklet, margin }))}
          <label className="export-opt">
            <input
              type="checkbox"
              checked={booklet.border}
              onChange={(e) => setBooklet({ ...booklet, border: e.target.checked })}
              disabled={busy}
            />
            Draw a border around each page
          </label>
        </>
      )}
      <p className="split-hint">
        {count === 0
          ? "No pages in this selection."
          : mode === "booklet"
            ? `${count} page${count === 1 ? "" : "s"} → ${sheets} printed sides on ${sheets / 2} sheet${sheets === 2 ? "" : "s"}. Print double-sided, flip on the short edge.`
            : `${count} page${count === 1 ? "" : "s"} → ${sheets} sheet${sheets === 1 ? "" : "s"}.`}
      </p>
      <Actions
        busy={busy}
        disabled={count === 0}
        action="Create & download"
        busyLabel="Working…"
        onAction={() => void submit()}
      />
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------

const STATUS_ORDER: A11yStatus[] = ["fail", "warn", "manual", "pass"];

const STATUS_LABEL: Record<A11yStatus, string> = {
  fail: "Problems",
  warn: "Warnings",
  manual: "Check by eye",
  pass: "Passed",
};

function StatusIcon({ status }: { status: A11yStatus }) {
  const props = { size: 16, "aria-hidden": true } as const;
  if (status === "fail") return <CircleX {...props} className="a11y-icon a11y-fail" />;
  if (status === "warn") return <TriangleAlert {...props} className="a11y-icon a11y-warn" />;
  if (status === "pass") return <CircleCheck {...props} className="a11y-icon a11y-pass" />;
  return <Eye {...props} className="a11y-icon a11y-manual" />;
}

function CheckRow({ check }: { check: A11yCheck }) {
  return (
    <li className="a11y-row">
      <StatusIcon status={check.status} />
      <span className="export-row-text">
        <span>{check.title}</span>
        {check.detail && <small>{check.detail}</small>}
        {check.pages && (
          <small>
            {check.pages.length === 1 ? "Page" : "Pages"} {summarizePages(check.pages)}
          </small>
        )}
      </span>
    </li>
  );
}

/** "1, 2, 3, 7 and 12 more" — keeps a long page list on one line. */
function summarizePages(pages: number[]): string {
  const shown = pages.slice(0, 8).join(", ");
  return pages.length > 8 ? `${shown} and ${pages.length - 8} more` : shown;
}

const COMMON_LANGUAGES = [
  "en",
  "en-US",
  "en-GB",
  "en-CA",
  "fr",
  "fr-CA",
  "es",
  "de",
  "pt",
  "pt-BR",
  "it",
  "nl",
  "ja",
  "zh",
  "ko",
  "ar",
  "hi",
];

/** Accessibility report for the document as it would download, plus quick fixes. */
export function AccessibilityDialog() {
  const { runAccessibilityCheck, downloadAccessibleCopy } = useEditorActions();
  const [result, setResult] = useState<{
    report: A11yReport;
    defaults: { title: string; lang: string };
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState("");
  const [showTitle, setShowTitle] = useState(true);
  const [busy, setBusy] = useState(false);

  // The check is read-only, so run it as soon as the dialog opens.
  useEffect(() => {
    let cancelled = false;
    void runAccessibilityCheck().then((r) => {
      if (cancelled) return;
      if (!r) return setFailed(true);
      setResult(r);
      setTitle(r.defaults.title);
      setLang(r.defaults.lang);
    });
    return () => {
      cancelled = true;
    };
    // runAccessibilityCheck is recreated every render but reads the store when called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const langInvalid = lang.trim() !== "" && !LANGUAGE_TAG.test(lang.trim());
  const needsDisplayFix =
    showTitle && (result?.report.checks.some((c) => c.id === "display-title") ?? false);
  const changed =
    result !== null &&
    ((title.trim() !== "" && title.trim() !== result.defaults.title) ||
      (lang.trim() !== "" && lang.trim() !== result.defaults.lang) ||
      needsDisplayFix);

  const submit = async () => {
    setBusy(true);
    try {
      await downloadAccessibleCopy({
        title,
        lang,
        displayDocTitle: showTitle,
      });
    } finally {
      setBusy(false);
    }
  };

  const counts = result?.report.counts;
  return (
    <DialogShell title="Accessibility check" busy={busy}>
      {!result && !failed && <p className="split-hint">Checking the document…</p>}
      {failed && <p className="split-hint">The check could not run on this document.</p>}
      {result && counts && (
        <>
          <p className="split-hint" role="status">
            {counts.fail} problem{counts.fail === 1 ? "" : "s"}, {counts.warn} warning
            {counts.warn === 1 ? "" : "s"}, {counts.pass} passed, {counts.manual} to check by eye.
            This looks at the document&apos;s structure; it cannot judge whether the reading order
            or descriptions are good.
          </p>
          <div className="a11y-report">
            {STATUS_ORDER.map((status) => {
              const rows = result.report.checks.filter((c) => c.status === status);
              if (rows.length === 0) return null;
              return (
                <section key={status} aria-label={STATUS_LABEL[status]}>
                  <h3 className="a11y-heading">{STATUS_LABEL[status]}</h3>
                  <ul className="a11y-list">
                    {rows.map((c) => (
                      <CheckRow key={c.id} check={c} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <fieldset className="export-fieldset a11y-fixes">
            <legend>Quick fixes (applied to a downloaded copy)</legend>
            <label className="export-opt a11y-field">
              Title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
                aria-label="Document title"
              />
            </label>
            <label className="export-opt a11y-field">
              Language
              <input
                type="text"
                list="a11y-languages"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                placeholder="en-US"
                disabled={busy}
                aria-label="Document language"
                aria-invalid={langInvalid}
              />
              <datalist id="a11y-languages">
                {COMMON_LANGUAGES.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
            {langInvalid && (
              <small className="a11y-error" role="alert">
                Use a language tag such as en, en-US or fr-CA.
              </small>
            )}
            <label className="export-opt">
              <input
                type="checkbox"
                checked={showTitle}
                onChange={(e) => setShowTitle(e.target.checked)}
                disabled={busy}
              />
              Show the title (not the file name) in the window bar
            </label>
          </fieldset>
        </>
      )}
      <Actions
        busy={busy}
        disabled={!result || langInvalid || !changed}
        action="Download fixed copy"
        busyLabel="Exporting…"
        cancelLabel="Close"
        onAction={() => void submit()}
      />
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------

/** Export a copy prepared for PDF/A-2b, and say honestly what that does and doesn't cover. */
export function PdfaDialog() {
  const { exportPdfA } = useEditorActions();
  const [removeRestricted, setRemoveRestricted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ applied: string[]; issues: PdfaIssue[] } | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      setResult(await exportPdfA({ removeRestricted }));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <DialogShell title="PDF/A export" busy={false}>
        <p className="split-hint" role="status">
          {result.issues.length === 0
            ? "Exported. Nothing this editor can detect stands in the way of PDF/A-2b, but the file has not been checked by an external validator."
            : `Exported, but ${result.issues.length} thing${result.issues.length === 1 ? "" : "s"} still stop${result.issues.length === 1 ? "s" : ""} it from conforming:`}
        </p>
        {result.issues.length > 0 && (
          <ul className="a11y-list">
            {result.issues.map((i) => (
              <li key={i.id} className="a11y-row">
                <TriangleAlert size={16} aria-hidden className="a11y-icon a11y-warn" />
                <span className="export-row-text">{i.message}</span>
              </li>
            ))}
          </ul>
        )}
        {result.applied.length > 0 && (
          <>
            <h3 className="a11y-heading">Changed in the copy</h3>
            <ul className="a11y-list">
              {result.applied.map((a) => (
                <li key={a} className="a11y-row">
                  <CircleCheck size={16} aria-hidden className="a11y-icon a11y-pass" />
                  <span className="export-row-text">{a}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="sig-actions">
          <button type="button" className="sig-insert" onClick={close}>
            Done
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="Export as PDF/A" busy={busy}>
      <p className="split-hint">
        PDF/A is the archival format. This prepares a copy for PDF/A-2b: it declares the standard,
        adds a colour profile and file identifier, and makes annotations printable. It does{" "}
        <strong>not</strong> embed fonts that are missing from the file and has not been checked by
        an external validator — use one (such as veraPDF) before relying on it for compliance.
      </p>
      <label className="export-opt export-row">
        <input
          type="checkbox"
          checked={removeRestricted}
          onChange={(e) => setRemoveRestricted(e.target.checked)}
          disabled={busy}
        />
        <span className="export-row-text">
          <span>Remove JavaScript and file attachments</span>
          <small>PDF/A does not allow either.</small>
        </span>
      </label>
      <Actions
        busy={busy}
        action="Export PDF/A"
        busyLabel="Exporting…"
        onAction={() => void submit()}
      />
    </DialogShell>
  );
}
