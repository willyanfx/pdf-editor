import { useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useBookmarksUiStore, type SidePanelTab } from "../store/useBookmarksUiStore";
import { useViewerStore } from "../store/useViewerStore";
import { PagePanel } from "./PagePanel";
import { BookmarksPanel } from "./BookmarksPanel";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { LayersPanel } from "./LayersPanel";

type Props = {
  /** The loaded pdf.js document, for the Layers view; null while it loads. */
  pdf: PDFDocumentProxy | null;
};

/**
 * The left sidebar: a tab switch over the page organizer, the bookmarks tree,
 * and — only when the open PDF has them — its attachments and layers. Rendered
 * inside the viewer's react-pdf <Document> so the page thumbnails can draw. The
 * Pages view stays mounted while hidden so its thumbnails and scroll position
 * survive switching back and forth.
 */
export function SidePanel({ pdf }: Props) {
  const savedTab = useBookmarksUiStore((s) => s.tab);
  const setTab = useBookmarksUiStore((s) => s.setTab);
  const attachmentCount = useViewerStore((s) => s.attachments.length);
  const hasLayers = useViewerStore((s) => s.layers !== null);
  const tabRefs = useRef(new Map<SidePanelTab, HTMLButtonElement>());

  const tabs: { id: SidePanelTab; label: string; count?: number }[] = [
    { id: "pages", label: "Pages" },
    { id: "bookmarks", label: "Bookmarks" },
    ...(attachmentCount > 0
      ? [{ id: "attachments" as const, label: "Attachments", count: attachmentCount }]
      : []),
    ...(hasLayers ? [{ id: "layers" as const, label: "Layers" }] : []),
  ];
  // A tab for something the document no longer has (a new file opened) falls back.
  const tab = tabs.some((t) => t.id === savedTab) ? savedTab : "pages";

  function onTabKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const i = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].id;
    setTab(next);
    tabRefs.current.get(next)?.focus();
  }

  return (
    <aside className="side-panel" aria-label="Sidebar" data-tabs={tabs.length}>
      <div className="side-panel-tabs" role="tablist" aria-label="Sidebar view">
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              if (el) tabRefs.current.set(t.id, el);
            }}
            type="button"
            role="tab"
            id={`side-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`side-tabpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={"side-panel-tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKeyDown}
          >
            {t.label}
            {t.count !== undefined && <span className="side-panel-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="side-tabpanel-pages"
        aria-labelledby="side-tab-pages"
        className="side-panel-body"
        hidden={tab !== "pages"}
      >
        <PagePanel onClose={() => {}} />
      </div>
      <div
        role="tabpanel"
        id="side-tabpanel-bookmarks"
        aria-labelledby="side-tab-bookmarks"
        className="side-panel-body"
        hidden={tab !== "bookmarks"}
      >
        {tab === "bookmarks" && <BookmarksPanel />}
      </div>
      {attachmentCount > 0 && (
        <div
          role="tabpanel"
          id="side-tabpanel-attachments"
          aria-labelledby="side-tab-attachments"
          className="side-panel-body"
          hidden={tab !== "attachments"}
        >
          {tab === "attachments" && <AttachmentsPanel />}
        </div>
      )}
      {hasLayers && (
        <div
          role="tabpanel"
          id="side-tabpanel-layers"
          aria-labelledby="side-tab-layers"
          className="side-panel-body"
          hidden={tab !== "layers"}
        >
          {tab === "layers" && <LayersPanel pdf={pdf} />}
        </div>
      )}
    </aside>
  );
}
