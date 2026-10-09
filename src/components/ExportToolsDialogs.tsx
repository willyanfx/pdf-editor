import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { usePageSelectionStore } from "../store/usePageSelectionStore";
import { useExportToolsUi } from "../store/useExportToolsUi";
import { useEditorActions, type PageScope } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { inVisibleOrder } from "../lib/pageRemap";
import { DPI_CHOICES, type ImageFormat } from "../lib/pageImages";
import {
  DEFAULT_SANITIZE,
  scanHiddenInfo,
  type HiddenInfoReport,
  type SanitizeOptions,
} from "../lib/sanitize";

/** Mounts whichever export-tool dialog the UI store says is open. */
export function ExportToolsDialogs() {
  const dialog = useExportToolsUi((s) => s.dialog);
  const file = useEditorStore((s) => s.file);
  if (!file) return null;
  if (dialog === "pageImages") return <PageImagesDialog />;
  if (dialog === "embeddedImages") return <EmbeddedImagesDialog />;
  if (dialog === "sanitize") return <SanitizeDialog />;
  return null;
}

/** Shared dialog chrome: backdrop, focus trap, header with a close button. */
function DialogShell({
  title,
  busy,
  children,
}: {
  title: string;
  busy: boolean;
  children: ReactNode;
}) {
  const onClose = () => {
    // Closing mid-export would orphan the running job's UI; let it finish.
    if (!busy) useExportToolsUi.getState().close();
  };
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);
  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sig-header">
          <span>{title}</span>
          <button
            type="button"
            className="sig-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/** Radio group choosing which pages an export covers. */
function ScopeChoice({
  scope,
  onChange,
  disabled,
}: {
  scope: PageScope;
  onChange: (scope: PageScope) => void;
  disabled: boolean;
}) {
  const numPages = useEditorStore((s) => s.pageOrder.length || s.numPages);
  const pageOrder = useEditorStore((s) => s.pageOrder);
  const selected = usePageSelectionStore((s) => s.selected);
  const selectedCount = inVisibleOrder(pageOrder, selected).length;
  const options: { value: PageScope; label: string; hidden?: boolean }[] = [
    { value: "all", label: `All pages (${numPages})` },
    { value: "current", label: "Current page" },
    {
      value: "selected",
      label: `Selected pages (${selectedCount})`,
      hidden: selectedCount === 0,
    },
  ];
  return (
    <fieldset className="export-fieldset" disabled={disabled}>
      <legend>Pages</legend>
      {options
        .filter((o) => !o.hidden)
        .map((o) => (
          <label key={o.value} className="export-opt">
            <input
              type="radio"
              name="export-scope"
              checked={scope === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
    </fieldset>
  );
}

/** Scope a dialog opens with: the page-panel selection when there is one. */
function initialScope(): PageScope {
  const { pageOrder } = useEditorStore.getState();
  const selected = inVisibleOrder(pageOrder, usePageSelectionStore.getState().selected);
  return selected.length ? "selected" : "all";
}

// ---------------------------------------------------------------------------

/** Export pages as PNG or JPEG images. */
function PageImagesDialog() {
  const { exportPagesAsImages } = useEditorActions();
  const [scope, setScope] = useState<PageScope>(initialScope);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [dpi, setDpi] = useState<number>(150);
  const [quality, setQuality] = useState(90);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const ok = await exportPagesAsImages({ format, dpi, quality: quality / 100, scope });
      if (ok) useExportToolsUi.getState().close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="Export pages as images" busy={busy}>
      <p className="split-hint">
        Pages are rendered with your edits applied. Several pages download as one .zip.
      </p>
      <ScopeChoice scope={scope} onChange={setScope} disabled={busy} />
      <div className="sig-tabs" role="tablist" aria-label="Image format">
        {(["png", "jpeg"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={format === f}
            className={format === f ? "active" : ""}
            onClick={() => setFormat(f)}
            disabled={busy}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      <label className="export-opt">
        Resolution
        <select
          value={dpi}
          onChange={(e) => setDpi(Number(e.target.value))}
          disabled={busy}
          aria-label="Resolution"
        >
          {DPI_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d} DPI{d === 72 ? " (screen)" : d === 150 ? " (standard)" : " (print)"}
            </option>
          ))}
        </select>
      </label>
      {format === "jpeg" && (
        <label className="export-opt">
          Quality: {quality}%
          <input
            type="range"
            min={40}
            max={100}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            disabled={busy}
            aria-label="JPEG quality"
          />
        </label>
      )}
      <div className="sig-actions">
        <button
          type="button"
          className="sig-cancel"
          onClick={() => useExportToolsUi.getState().close()}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="button" className="sig-insert" onClick={() => void submit()} disabled={busy}>
          {busy ? "Exporting…" : "Export"}
        </button>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------

/** Save the images embedded in the document. */
function EmbeddedImagesDialog() {
  const { saveEmbeddedImages } = useEditorActions();
  const [scope, setScope] = useState<PageScope>(initialScope);
  const [skipSmall, setSkipSmall] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const ok = await saveEmbeddedImages({ scope, minSize: skipSmall ? 64 : 0 });
      if (ok) useExportToolsUi.getState().close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="Save embedded images" busy={busy}>
      <p className="split-hint">
        Saves the pictures stored inside the PDF. JPEG images are saved exactly as embedded; other
        formats are converted to PNG. Several images download as one .zip.
      </p>
      <ScopeChoice scope={scope} onChange={setScope} disabled={busy} />
      <label className="export-opt">
        <input
          type="checkbox"
          checked={skipSmall}
          onChange={(e) => setSkipSmall(e.target.checked)}
          disabled={busy}
        />
        Skip small images (under 64 px — icons, rules, bullets)
      </label>
      <div className="sig-actions">
        <button
          type="button"
          className="sig-cancel"
          onClick={() => useExportToolsUi.getState().close()}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="button" className="sig-insert" onClick={() => void submit()} disabled={busy}>
          {busy ? "Saving…" : "Save images"}
        </button>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------

const SANITIZE_ROWS: { key: keyof SanitizeOptions; label: string; hint: string }[] = [
  {
    key: "metadata",
    label: "Metadata",
    hint: "Author, title, dates, XMP, private app data, page thumbnails",
  },
  { key: "comments", label: "Comments and markup", hint: "Notes, highlights, stamps, drawings" },
  { key: "attachments", label: "File attachments", hint: "Embedded files and attachment icons" },
  {
    key: "javascript",
    label: "JavaScript",
    hint: "Scripts in the document, links and form fields",
  },
  { key: "bookmarks", label: "Bookmarks", hint: "The bookmark outline" },
];

/** Count to show beside a category once the scan finishes. */
function countFor(report: HiddenInfoReport | null, key: keyof SanitizeOptions): string {
  if (!report) return "";
  const n = report[key];
  return key === "metadata" ? (n ? "found" : "none") : n ? String(n) : "none";
}

/** Remove hidden information and download a cleaned copy. */
function SanitizeDialog() {
  const { removeHiddenInfo } = useEditorActions();
  const file = useEditorStore((s) => s.file);
  const hasForm = useEditorStore((s) => (s.formFields?.length ?? 0) > 0);
  const [options, setOptions] = useState<SanitizeOptions>(DEFAULT_SANITIZE);
  const [flattenForms, setFlattenForms] = useState(false);
  const [report, setReport] = useState<HiddenInfoReport | null>(null);
  const [busy, setBusy] = useState(false);

  // Show what the document actually contains next to each option.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void file
      .arrayBuffer()
      .then((buf) => scanHiddenInfo(new Uint8Array(buf)))
      .then((r) => !cancelled && setReport(r))
      .catch(() => {
        /* counts are a nicety; the removal itself still works */
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const submit = async () => {
    setBusy(true);
    try {
      const ok = await removeHiddenInfo({ ...options, flattenForms: flattenForms && hasForm });
      if (ok) useExportToolsUi.getState().close();
    } finally {
      setBusy(false);
    }
  };

  const anything = Object.values(options).some(Boolean) || (flattenForms && hasForm);

  return (
    <DialogShell title="Remove hidden information" busy={busy}>
      <p className="split-hint">
        Downloads a cleaned copy with your edits applied. Your open document is not changed.
      </p>
      <div className="export-list">
        {SANITIZE_ROWS.map((row) => (
          <label key={row.key} className="export-opt export-row">
            <input
              type="checkbox"
              checked={options[row.key]}
              onChange={(e) => setOptions((o) => ({ ...o, [row.key]: e.target.checked }))}
              disabled={busy}
            />
            <span className="export-row-text">
              <span>{row.label}</span>
              <small>{row.hint}</small>
            </span>
            <span className="export-count">{countFor(report, row.key)}</span>
          </label>
        ))}
        {hasForm && (
          <label className="export-opt export-row">
            <input
              type="checkbox"
              checked={flattenForms}
              onChange={(e) => setFlattenForms(e.target.checked)}
              disabled={busy}
            />
            <span className="export-row-text">
              <span>Form fields</span>
              <small>Flatten into plain page content (no longer fillable)</small>
            </span>
          </label>
        )}
      </div>
      {report && report.hiddenLayers > 0 && (
        <p className="split-hint">
          This document has {report.hiddenLayers} hidden layer
          {report.hiddenLayers === 1 ? "" : "s"}. They can&apos;t be removed automatically without
          revealing their content, so they are left as they are.
        </p>
      )}
      <div className="sig-actions">
        <button
          type="button"
          className="sig-cancel"
          onClick={() => useExportToolsUi.getState().close()}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sig-insert"
          onClick={() => void submit()}
          disabled={busy || !anything}
        >
          {busy ? "Cleaning…" : "Remove & download"}
        </button>
      </div>
    </DialogShell>
  );
}
