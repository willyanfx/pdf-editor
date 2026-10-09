import { useRef } from "react";
import { useBookmarksUiStore, type SidePanelTab } from "../store/useBookmarksUiStore";
import { PagePanel } from "./PagePanel";
import { BookmarksPanel } from "./BookmarksPanel";
import { CommentsPanel } from "./CommentsPanel";

const TABS: { id: SidePanelTab; label: string }[] = [
  { id: "pages", label: "Pages" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "comments", label: "Comments" },
];

/**
 * The left sidebar: a "Pages | Bookmarks | Comments" switch over the page
 * organizer, the bookmarks tree and the comments list. Rendered inside the viewer's react-pdf <Document> so the
 * page thumbnails can draw. The Pages view stays mounted while hidden so its
 * thumbnails and scroll position survive switching back and forth.
 */
export function SidePanel() {
  const tab = useBookmarksUiStore((s) => s.tab);
  const setTab = useBookmarksUiStore((s) => s.setTab);
  const tabRefs = useRef(new Map<SidePanelTab, HTMLButtonElement>());

  function onTabKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    tabRefs.current.get(next)?.focus();
  }

  return (
    <aside className={"side-panel" + (tab === "comments" ? " wide" : "")} aria-label="Sidebar">
      <div className="side-panel-tabs" role="tablist" aria-label="Sidebar view">
        {TABS.map((t) => (
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
      <div
        role="tabpanel"
        id="side-tabpanel-comments"
        aria-labelledby="side-tab-comments"
        className="side-panel-body"
        hidden={tab !== "comments"}
      >
        {tab === "comments" && <CommentsPanel />}
      </div>
    </aside>
  );
}
