# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A fully client-side PDF editor (React 19 + TypeScript, Vite+, Zustand). No backend — every feature (rendering, editing, OCR, conversion, export) runs in the browser. Deployed to GitHub Pages under `base: /pdf-editor/`.

## Commands

This project uses **Vite+** (`vp`), a unified toolchain wrapping Vite/Vitest/Oxlint/Oxfmt — see AGENTS.md for the full command reference. Never invoke pnpm/npx/vitest/oxlint directly; the package.json scripts wrap `vp`.

```bash
pnpm dev                          # dev server (predev copies pdfjs WASM into public/wasm/)
pnpm build                        # tsc && vp build
pnpm lint                         # oxlint (type-aware) — vp check runs format+lint+tsc
pnpm format
pnpm test                         # Vitest unit tests
pnpm test src/lib/richText.test.ts   # single test file
pnpm test:e2e                     # Playwright smoke tests (e2e/, Chromium, boots real dev server)
```

Unit tests live next to their modules (`src/lib/*.test.ts`); the e2e specs in `e2e/` are excluded from Vitest and only run via Playwright.

## Architecture

### Document model: everything is an edit object in the Zustand store

`src/store/useEditorStore.ts` is the single source of truth: the loaded PDF bytes, the `PdfEdit` discriminated union (`TextEdit | ImageEdit | MarkupEdit | CommentEdit | InkEdit | ...`), per-page ops (rotate/crop/reorder/delete), OCR state, and snapshot-based undo/redo (100 steps, burst-coalesced). The original PDF is never mutated in place — edits are overlays until export.

**Adding a new edit type** touches four places: extend the `PdfEdit` union + add a factory in `useEditorStore.ts`, render it in `EditableLayer.tsx`, and bake it in `lib/exportPdf.ts`.

**Comments are edits too.** Highlight/underline/strikeout, sticky notes, ink, rectangle, line/arrow/oval/polygon/cloud and stamps are the "annotation family" (`isAnnotation` in `lib/annotations.ts`); each can carry `CommentFields` (note, author, review status, replies). `lib/annotationExport.ts` writes them either flattened or as native PDF annotations from one appearance-stream builder (chosen by `ExportOptions.annotations`, preference in `useCommentsUiStore`); `lib/xfdf.ts` converts them to/from XFDF; the sidebar's Comments tab is `CommentsPanel.tsx`. A new annotation type also needs a case in `annotationExport.ts` `build()` and `xfdf.ts`.

`src/hooks/useEditorActions.ts` is the unified action layer — TopBar, ToolRail, CommandPalette, and keyboard shortcuts all dispatch through it rather than calling the store directly.

### One coordinate system: 800px screen space

All coordinates (edits, OCR boxes, text extraction, export) live in `VIEWER_WIDTH = 800` screen space, defined in `src/lib/pdfGeometry.ts`. Zoom is CSS-transform only. OCR recognition, the editor overlays, and the pdf-lib bake all share this space — never introduce a second coordinate system; convert at the boundary via `pdfGeometry.ts`.

### Two PDF libraries with distinct roles

- `pdfjs-dist` (+ `react-pdf`): rendering, text/image extraction. **Version is pinned to 5.4.296** — it must exactly match the version react-pdf bundles or rendering fails with an API/Worker mismatch.
- `pdf-lib` (+ fontkit): all mutation — baking edits, rotation, crop, merge/split, compress, Google Font subsetting — in `lib/exportPdf.ts`, `mergeSplitPdf.ts`, `pageInsert.ts`.

### OCR: three engines behind one dispatch

`src/lib/vlmOcr/dispatch.ts` routes to:

- **Tesseract.js** (WASM, `lib/ocr.ts`) — always available, singleton worker, Sauvola binarization preprocessing. Note: `word.is_bold` is always false under LSTM; bold is inferred from canvas ink density instead (`vlmOcr/fontSize.ts`).
- **Florence-2** (WebGPU, `vlmOcr/florence2.worker.ts`) — in-browser VLM via `@huggingface/transformers`, ~275MB model cached by the browser.
- **PaddleOCR.js** (beta, `vlmOcr/paddleOcr.ts`) — single-threaded only; models load from Baidu CDN.

All engines emit bounding boxes in the 800px space; `fontSize.ts` estimates font size/bold from box heights, and results become ordinary editable `TextEdit` overlays with background-sampled cover rectangles.

### Vite config is load-bearing — read the comments before touching it

`vite.config.ts` encodes several hard-won constraints: COOP/COEP headers for `SharedArrayBuffer` (multithreaded OCR; GitHub Pages can't set them, so production falls back to single-threaded), `process.env.DRAGGABLE_DEBUG` shim (react-rnd crashes without it), `optimizeDeps` include/exclude lists required by transformers.js and paddleocr's CJS imports, and ESM worker format for the VLM worker. Breaking any of these fails only at runtime, not build time.

### Viewer state and layout

- View-only state (theme, single/two-page layout, full screen, the open PDF's attachments and layers) lives in `src/store/useViewerStore.ts`, not the editor store — it isn't undoable, autosaved or exported. Theme and layout persist in `localStorage`.
- The page stage scrolls in **rows** (`lib/pageLayout.ts`): one page, or two side by side. Pages deleted in the organizer are in no row. Use `buildPageRows`/`stepPage`/`rowIndexOfPage` rather than assuming page index == virtual item index.
- Layer visibility works by wrapping `PDFPageProxy.prototype.render` (`lib/layers.ts`), because react-pdf can't pass `optionalContentConfigPromise`; `layerVersion` re-keys `<Page>`/`<Thumbnail>` to repaint.

### Gotchas

- The page virtualizer works in **on-screen pixels**: row sizes are multiplied by `zoom`, and page shells sit at `item.start / zoom` inside the zoom-scaled spacer. Mixing unscaled offsets with the scroll container's `scrollTop` makes the page readout and jump-to-page wrong at any zoom other than 100%.

- A `useEffect` that resets its own trigger flag at the top cancels its own in-flight async work — reset in `finally` instead (this bit the OCR flows).
- When verifying in a real browser: pdf.js keeps the page busy so screenshot/read_page tools time out on this app — drive and assert with injected JavaScript instead.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay, not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model    | cost | intelligence | taste |
| -------- | ---- | ------------ | ----- |
| sonnet-5 | 5    | 5            | 7     |
| opus-4.8 | 4    | 7            | 8     |
| fable-5  | 2    | 9            | 9     |

How to apply:

- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > taste > cost.
- **Small / clear-spec tasks (mechanical edits, data entry, straightforward implementation): use sonnet-5.** It's the cheap default for well-scoped work.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7.
- Reviews of plans/implementations: fable-5 or opus-4.8.
- Never use Haiku.
- Claude models (sonnet-5, opus-4.8, fable-5) run via the Agent/Workflow `model` parameter.
