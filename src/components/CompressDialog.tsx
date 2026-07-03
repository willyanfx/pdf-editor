import { useState, useEffect, useCallback, useRef } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { useEditorActions } from "../hooks/useEditorActions";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { CompressOptions, CompressPreset } from "../lib/compressPresets";
import { COMPRESS_PRESETS } from "../lib/compressPresets";
import { formatBytes } from "../lib/pdfMetadata";

type CompressState = "idle" | "estimating" | "exporting" | "done";

const PRESET_DESCRIPTIONS: Record<Exclude<CompressPreset, "custom">, string> = {
  lossless: "Structural compression only — no image resampling. Preserves all quality.",
  screen: "Optimized for screen reading and email. Smaller file, lower image resolution.",
  ebook: "Balanced quality for e-readers and tablets. Good size/quality trade-off.",
  printer: "Suitable for desktop printing. High quality, moderate compression.",
  prepress: "Near-original quality for professional printing workflows.",
};

export function CompressDialog() {
  const open = useEditorStore((s) => s.compressDialogOpen);
  const file = useEditorStore((s) => s.file);
  const { compressPdf } = useEditorActions();

  const [tab, setTab] = useState<CompressPreset>("ebook");
  const [options, setOptions] = useState<CompressOptions>(COMPRESS_PRESETS.ebook);
  const [grayscale, setGrayscale] = useState(false);
  const [stripMeta, setStripMeta] = useState(false);
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [compressState, setCompressState] = useState<CompressState>("idle");

  // Ref for the auto-close timer so we can cancel it if the dialog is closed
  // manually before the 1200 ms delay expires (prevents the timer from silently
  // closing a freshly-reopened dialog).
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onClose = () => {
    if (autoCloseRef.current !== null) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    useEditorStore.getState().setCompressDialogOpen(false);
  };
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  /** Build options from a preset tab, propagating toggles. */
  const selectPreset = useCallback(
    (preset: CompressPreset) => {
      if (preset === "custom") {
        setOptions((prev) => ({
          ...prev,
          preset: "custom",
          grayscale,
          stripMetadata: stripMeta,
        }));
      } else {
        setOptions({
          ...COMPRESS_PRESETS[preset],
          grayscale,
          stripMetadata: stripMeta,
        });
      }
    },
    [grayscale, stripMeta],
  );

  // Re-propagate toggle changes into the current preset's options.
  useEffect(() => {
    setOptions((prev) => ({ ...prev, grayscale, stripMetadata: stripMeta }));
  }, [grayscale, stripMeta]);

  // Estimation effect: debounced 300ms, lazy-import estimateCompressedSize.
  useEffect(() => {
    if (!open || !file) {
      setEstimatedSize(null);
      return;
    }
    // Do not interrupt an in-progress export — the user touched a control during
    // compression. Overwriting 'exporting' with 'estimating' would re-enable the
    // Compress button and allow a second concurrent export.
    if (compressState === "exporting") return;
    setCompressState("estimating");
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { estimateCompressedSize } = await import("../lib/exportPdf");
          const fileBytes = new Uint8Array(await file.arrayBuffer());
          if (cancelled) return;
          const est = await estimateCompressedSize(fileBytes, options);
          if (!cancelled) {
            setEstimatedSize(est);
            setCompressState("idle");
          }
        } catch {
          if (!cancelled) {
            setEstimatedSize(null);
            setCompressState("idle");
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, options, file]);

  if (!open) return null;

  function handleTabClick(preset: CompressPreset) {
    setTab(preset);
    selectPreset(preset);
  }

  const submit = () => {
    void compressPdf(
      {
        onStart: () => setCompressState("exporting"),
        onSuccess: () => {
          setCompressState("done");
          autoCloseRef.current = setTimeout(() => {
            autoCloseRef.current = null;
            setCompressState("idle");
            onClose();
          }, 1200);
        },
        onError: () => setCompressState("idle"),
      },
      options,
    );
  };

  const currentSize = file?.size ?? 0;
  const isExporting = compressState === "exporting";

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Compress PDF"
      >
        <div className="sig-header">
          <span>Compress PDF</span>
          <button type="button" className="sig-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="split-hint">
          Current size: {formatBytes(currentSize)}
          {estimatedSize !== null && estimatedSize > 0 && compressState !== "estimating" && (
            <> &rarr; estimated ~{formatBytes(estimatedSize)}</>
          )}
          {compressState === "estimating" && <> &rarr; estimating…</>}
        </p>

        <div className="sig-tabs" role="tablist" aria-label="Compression preset">
          {(
            ["lossless", "screen", "ebook", "printer", "prepress", "custom"] as CompressPreset[]
          ).map((preset) => (
            <button
              key={preset}
              type="button"
              role="tab"
              aria-selected={tab === preset}
              className={tab === preset ? "active" : ""}
              onClick={() => handleTabClick(preset)}
              disabled={isExporting}
            >
              {preset.charAt(0).toUpperCase() + preset.slice(1)}
            </button>
          ))}
        </div>

        <div role="tabpanel" aria-label={`${tab} settings`}>
          {tab !== "custom" && <p className="split-hint">{PRESET_DESCRIPTIONS[tab]}</p>}

          {tab === "custom" && (
            <div className="split-hint">
              <div style={{ marginBottom: 8 }}>
                <label htmlFor="compress-targetpx">
                  Max dimension: {options.targetPx.toLocaleString()} px
                </label>
                <input
                  id="compress-targetpx"
                  type="range"
                  min={600}
                  max={3508}
                  step={100}
                  value={options.targetPx}
                  onChange={(e) =>
                    setOptions((prev) => ({
                      ...prev,
                      targetPx: Number.parseInt(e.target.value, 10),
                    }))
                  }
                  disabled={isExporting}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label htmlFor="compress-quality">
                  JPEG quality: {Math.round(options.quality * 100)}%
                </label>
                <input
                  id="compress-quality"
                  type="range"
                  min={30}
                  max={100}
                  step={1}
                  value={Math.round(options.quality * 100)}
                  onChange={(e) =>
                    setOptions((prev) => ({
                      ...prev,
                      quality: Number.parseInt(e.target.value, 10) / 100,
                    }))
                  }
                  disabled={isExporting}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </div>
              <div style={{ marginBottom: 4 }}>
                <label htmlFor="compress-mode">Mode:</label>
                <select
                  id="compress-mode"
                  value={options.mode}
                  onChange={(e) =>
                    setOptions((prev) => ({
                      ...prev,
                      mode: e.target.value as "selective" | "rasterize",
                    }))
                  }
                  disabled={isExporting}
                  style={{ marginLeft: 8 }}
                >
                  <option value="selective">Selective (preserve text &amp; vectors)</option>
                  <option value="rasterize">Rasterize (maximum reduction)</option>
                </select>
              </div>
            </div>
          )}

          <div className="split-hint" style={{ marginTop: 8 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
                opacity: tab === "lossless" ? 0.5 : 1,
              }}
              title={
                tab === "lossless"
                  ? "Grayscale is not applied in Lossless mode — images are not re-encoded"
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={grayscale}
                onChange={(e) => setGrayscale(e.target.checked)}
                disabled={isExporting || tab === "lossless"}
              />
              Convert to grayscale
              {tab === "lossless" && (
                <span style={{ fontSize: "0.85em", fontStyle: "italic" }}>
                  (not available in Lossless mode)
                </span>
              )}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={stripMeta}
                onChange={(e) => setStripMeta(e.target.checked)}
                disabled={isExporting}
              />
              Strip document metadata
            </label>
          </div>
        </div>

        <div className="sig-actions">
          <button type="button" className="sig-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sig-insert" onClick={submit} disabled={isExporting}>
            {isExporting
              ? "Compressing…"
              : compressState === "done"
                ? "Done!"
                : "Compress & Download"}
          </button>
        </div>
      </div>
    </>
  );
}
