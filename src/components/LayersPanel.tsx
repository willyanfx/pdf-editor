import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronRight, RotateCcw } from "lucide-react";
import { useViewerStore } from "../store/useViewerStore";
import { resetLayers, setLayerVisibility } from "../lib/layers";
import type { LayerNode } from "../lib/layerTree";

type Props = {
  /** The loaded document the layers belong to; null while it's still loading. */
  pdf: PDFDocumentProxy | null;
};

/**
 * The PDF's layers (optional content groups). Toggling one repaints the pages;
 * it's a viewing aid, so the downloaded PDF keeps the file's own defaults.
 */
export function LayersPanel({ pdf }: Props) {
  const layers = useViewerStore((s) => s.layers);
  const applyVisibility = useViewerStore((s) => s.setLayerVisibility);
  // Folders the user has folded shut, by their path in the tree.
  const [collapsed, setCollapsed] = useState<Record<string, true>>({});

  if (!layers) return null;
  const { tree, visibility, initial } = layers;
  const changed = Object.keys(initial).some((id) => initial[id] !== visibility[id]);

  function toggle(id: string, visible: boolean) {
    const next = pdf && setLayerVisibility(pdf, id, visible);
    if (next) applyVisibility(next);
  }

  function reset() {
    const next = pdf && resetLayers(pdf);
    if (next) applyVisibility(next);
  }

  function toggleFolder(path: string) {
    setCollapsed((c) => {
      const next = { ...c };
      if (next[path]) delete next[path];
      else next[path] = true;
      return next;
    });
  }

  function renderNodes(nodes: LayerNode[], path: string, depth: number) {
    return (
      <ul className="layer-list">
        {nodes.map((node, i) => {
          if (node.kind === "layer") {
            return (
              <li key={node.id} className="layer-row" style={{ paddingLeft: depth * 14 + 8 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={visibility[node.id] ?? true}
                    disabled={!pdf}
                    onChange={(e) => toggle(node.id, e.target.checked)}
                  />
                  <span className="layer-name" title={node.name}>
                    {node.name}
                  </span>
                </label>
              </li>
            );
          }
          const folderPath = `${path}/${i}:${node.name}`;
          const open = !collapsed[folderPath];
          return (
            <li key={folderPath}>
              <button
                type="button"
                className="layer-folder"
                style={{ paddingLeft: depth * 14 + 4 }}
                aria-expanded={open}
                onClick={() => toggleFolder(folderPath)}
              >
                <ChevronRight
                  size={13}
                  className={"layer-twisty" + (open ? " open" : "")}
                  aria-hidden="true"
                />
                <span className="layer-name" title={node.name}>
                  {node.name}
                </span>
              </button>
              {open && renderNodes(node.children, folderPath, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="layer-panel">
      <div className="bm-header">
        <span className="layer-heading">Show or hide parts of the page</span>
        <span className="bm-header-spacer" />
        <button
          type="button"
          className="bm-icon-btn"
          title="Reset layers to the file's defaults"
          aria-label="Reset layers"
          disabled={!changed || !pdf}
          onClick={reset}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="layer-tree">{renderNodes(tree, "", 0)}</div>
    </div>
  );
}
