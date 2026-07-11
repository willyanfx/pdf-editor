# HTML → PDF: Implementation Plan

## 1. Recommendation

Render each HTML file inside a hidden `iframe srcdoc`, wait for both the `load` event and `iframe.contentDocument.fonts.ready`, rasterize with **html2canvas-pro** at scale 2, slice the resulting canvas into A4-height chunks via `OffscreenCanvas`, encode each as JPEG using `convertToBlob`, and embed into a pdf-lib `PDFDocument` via `embedJpg`. The function ships as `htmlToPdf(file: File): Promise<Uint8Array>` inside the existing `src/lib/convertToPdf.ts` using a dynamic import, keeping the main bundle unchanged.

Output is raster-only (text not selectable). This is the correct trade-off for a zero-backend GitHub Pages deployment — full CSS fidelity because the browser actually renders the iframe, one new lazily-loaded dependency, ships in days.

**Why not the alternatives:**

- DOM serializer (Proposal 2): `getBoundingClientRect` cannot reconstruct CSS Grid or `position:absolute` layouts; its v1 was functionally identical to this plan but with 3–5 weeks of additional unreliable serializer code deferred.
- Canvas-raster variant (Proposal 3): used synchronous `canvas.toDataURL` (main-thread-blocking) instead of async `OffscreenCanvas.convertToBlob`, and its CORS tainting recovery was weaker.

---

## 2. Architecture

### Pipeline

```
File (*.html) → file.text() → iframe srcdoc
                                    ↓  (browser renders, fetches remote CSS & fonts)
                               await load + fonts.ready
                                    ↓
                          pre-fetch images → data URIs  (CORS guard)
                                    ↓
                          spacer-div page-break pass
                                    ↓
                 html2canvas-pro (scale:2, useCORS:true, allowTaint:false)
                                    ↓  (tall canvas — full document height)
                     OffscreenCanvas — A4 slices → convertToBlob (JPEG)
                                    ↓
                  pdf-lib PDFDocument — embedJpg + addPage([595.28, 841.89])
                                    ↓
                          doc.save() → Uint8Array → setFile / insertPages
```

### Remote CSS

The `srcdoc` iframe is same-origin with the parent page. The browser fetches `<link href="https://fonts.googleapis.com/...">` stylesheets through its normal network pipeline before the `load` event fires. html2canvas-pro reads `getComputedStyle()` — never raw `cssRules` — so the cross-origin `SecurityError` is never triggered. The explicit `fonts.ready` wait ensures glyphs have been downloaded before capture.

### Remote images — CORS guard before capture

Before calling html2canvas-pro, walk every `img[src]` in the iframe document and attempt `fetch(src, { mode: 'cors' })`. On success, replace the src with `URL.createObjectURL(blob)`. On CORS failure, substitute a 1×1 transparent PNG data URI and record the failed URL. After export, revoke all object URLs and surface a toast listing omitted images.

**Why not `useCORS:true` alone:** html2canvas-pro's `useCORS:true` only activates `crossOrigin="anonymous"` on images it judges non-same-origin. Images that redirect to a CDN, or cached before the attribute was set, can still taint the canvas — and a single tainted pixel causes the entire `convertToBlob` call to throw `SecurityError`, giving the user no PDF at all. The pre-fetch pass eliminates this failure mode entirely.

### Pagination

**Pass 1 (pre-capture):** Walk all block-level elements via `getBoundingClientRect()`. For each element that straddles a page boundary _and_ fits within a single A4 height, inject a spacer `<div>` above it. This is the html2pdf.js algorithm (PR #158), implemented directly to avoid that library's known 20-page regression (issue #227). Elements taller than one page are cut at the boundary.

**Pass 2 (post-capture):** The full-document canvas is sliced into A4-height strips using `OffscreenCanvas`, each encoded asynchronously via `convertToBlob`.

**Iframe geometry:** Render at **794px wide** (A4 at 96 DPI, not 800px). pdf-lib page size is `[595.28, 841.89]` pt. The 800px `VIEWER_WIDTH` coordinate system is irrelevant here — these are standalone PDF pages, not editor overlays.

### Combining multiple HTML files

No new orchestration needed. The existing `buildInsertedPdf` in `src/lib/pageInsert.ts` accepts `InsertSource[]` where `kind: 'convert'` routes through `convertToPdf → htmlToPdf → PDFDocument.load → out.copyPages`. `addPages` in `useEditorActions.ts` already maps each file to `{ kind: 'convert', file }`.

### OffscreenCanvas blob type guard

After each `convertToBlob` call, assert `blob.type === 'image/jpeg'`. If the browser silently fell back to PNG (allowed by spec), call `embedPng` instead of `embedJpg` to avoid an "SOI not found" parse error.

---

## 3. Step-by-Step Implementation

**Step 1 — `src/lib/convertToPdf.ts` — Implement `htmlToPdf` and extend `CONVERTIBLE_ACCEPT`**

Add `'html'` to the `isConvertible` extensions array (line 24) and append `'.html,text/html'` to `CONVERTIBLE_ACCEPT` (lines 11–15). Add `if (ext === 'html') return htmlToPdf(file);` inside `convertToPdf()`.

Implement `async function htmlToPdf(file: File): Promise<Uint8Array>`:

1. `file.text()` to get the HTML string
2. Create hidden iframe (`position:fixed; left:-9999px; width:794px; height:1px; overflow:hidden`), set `iframe.srcdoc`, await `load` event then `iframe.contentDocument.fonts.ready`
3. Pre-fetch image pass: walk all `img[src]`, `fetch(src, {mode:'cors'})` → `URL.createObjectURL` on success, transparent 1×1 PNG data URI on failure, record failures in a `Set<string>`
4. Spacer-div page-break pass using `getBoundingClientRect`
5. `const { default: html2canvas } = await import('html2canvas-pro')`, call with `{scale:2, useCORS:true, allowTaint:false, logging:false}`
6. Slice canvas into A4-height chunks via `OffscreenCanvas`, encode with `convertToBlob({type:'image/jpeg', quality:0.88})`, guard `blob.type === 'image/jpeg'` and fall back to `embedPng` if not
7. Create `PDFDocument`, `addPage([595.28, 841.89])` per slice, `embedJpg + drawImage`
8. Wrap in `try/finally` to guarantee iframe removal and object URL revocation
9. Return `doc.save()`
10. After resolution, if the failures set is non-empty emit a toast listing omitted URLs

Re-export or inline `dataUrlToBytes` from `src/lib/exportPdf.ts` (currently private at line 953).

---

**Step 2 — `src/lib/openFiles.ts` — Extend drop-detection regex**

At line 138, change `/\.(docx|xlsx|xls|csv|png|jpe?g|heic|heif)$/i` to `/\.(docx|xlsx|xls|csv|png|jpe?g|heic|heif|html)$/i`. Also add `|| f.type === 'text/html'` alongside the regex check.

---

**Step 3 — `src/hooks/useEditorActions.ts` — Update `convertFile` accept string**

In `convertFile()` around line 113, replace the hard-coded accept string literal with the `CONVERTIBLE_ACCEPT` constant imported from `convertToPdf.ts`. `addPages()` already uses `CONVERTIBLE_ACCEPT` and gains HTML support automatically.

---

**Step 4 — `src/components/InsertMenu.tsx` — Expose HTML in insert menu (recommended)**

`pickOffice()` already uses `CONVERTIBLE_ACCEPT` and automatically gains `.html`. Optionally add an explicit **HTML...** button next to "Word / Excel..." with a `FileCode` lucide icon and `accept='.html,text/html'` with `multiple=true`, routing files as `{ kind: 'convert', file }`.

---

**Step 5 — `src/components/App.tsx` — Drop overlay text**

At line 253, add `.html` to the displayed list of supported file types. One line.

---

**Step 6 — `vite.config.ts` — Verify pre-bundling**

html2canvas-pro is ESM, no WASM, no CJS default imports — no changes needed proactively. After installing, run `pnpm dev` and attempt an HTML conversion. If Vite warns or the dynamic import fails, add `'html2canvas-pro'` to `optimizeDeps.include`.

---

**Step 7 — `src/lib/convertToPdf.test.ts` — Unit tests**

Follow the existing `vi.mock('heic-to')` pattern:

- Happy path: mock returns a 595×842 canvas, assert bytes begin with `%PDF`
- CORS failure: mock `fetch` throws for one URL, assert function resolves and failures set contains that URL
- PNG fallback: mock `convertToBlob` returns `type='image/png'`, assert `embedPng` called
- Multi-page: mock canvas height = 2× A4, assert resulting PDF has 2 pages
- Empty HTML: function resolves to a valid single-page PDF
- Iframe cleanup: mock html2canvas-pro throws, assert no `<iframe>` remains in `document.body`

---

## 4. Dependencies

| Package           | Version  | Bundle impact                                                                                          |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `html2canvas-pro` | `^2.2.3` | ~90KB gzipped, loaded only on first HTML conversion via dynamic import — zero effect on initial bundle |

No other new dependencies. pdf-lib, @pdf-lib/fontkit, and OffscreenCanvas are already present. jsPDF excluded deliberately — redundant 300KB PDF engine alongside pdf-lib.

```
pnpm add html2canvas-pro
```

**Dependency health note:** This is a one-maintainer community fork. The project's existing posture accepts single-maintainer dependencies (heic-to follows the same pattern). If the fork stalls, options are: pin to the last working version, vendor the fork, or switch to a WASM rasterizer. See Open Questions.

---

## 5. Failure Modes & Graceful Degradation

**[HIGH] Canvas SecurityError from tainted pixels**
_Scenario:_ A cross-origin image bypasses the pre-fetch pass (e.g. a CSS `background-image`), taints the canvas, and `convertToBlob` throws — user gets no PDF.
_Mitigation:_ The pre-fetch image pass handles `img[src]` elements. Additionally wrap `convertToBlob` in `try/catch`; on `SecurityError`, retry with `allowTaint:true` and warn the user that the output cannot be re-exported.

**[HIGH] Canvas too large for low-memory devices**
_Scenario:_ A 10-page A4 document at scale:2 is ~71 megapixels. Some browsers enforce canvas area limits; the canvas may return blank or throw.
_Mitigation:_ Catch errors from the html2canvas-pro call. On failure, retry at `scale:1`. Toast: "This HTML file is very long — export quality was reduced."

**[MEDIUM] Web font or remote stylesheet not applied at capture time**
_Scenario:_ `font-display: swap` or a slow CDN causes the html2canvas-pro internal re-clone to capture the wrong font metrics.
_Mitigation:_ Use the `onclone` callback to inline all `getComputedStyle` values as inline styles on the cloned root, eliminating the re-clone stylesheet race.

**[MEDIUM] pdf-lib copyPages XObject bloat (issue #1662)**
_Scenario:_ Combining three 5-page HTML-derived PDFs can produce 30–60 MB output.
_Mitigation:_ Always pass `doc.getPageIndices()` in a single `copyPages` call per source (already how `buildInsertedPdf` is written). Point users to the existing Compress PDF action. Auto-trigger `compressEditedPdf()` if output exceeds a configurable threshold (e.g. 20 MB).

**[MEDIUM] JS-dependent pages render incomplete**
_Scenario:_ Single-page apps or content set by JavaScript after `load` will not be captured.
_Mitigation:_ Documented limitation. UI description: "Convert static HTML documents to PDF." Users should save fully-rendered HTML from their browser first.

**[LOW] Unsupported CSS properties**
_Scenario:_ `backdrop-filter`, advanced `clip-path`, CSS subgrid render incorrectly in the canvas pass.
_Mitigation:_ Documented limitation. The iframe render is the visual source of truth; the PDF is best-effort.

---

## 6. Test Plan

**Unit tests** (`src/lib/convertToPdf.test.ts`, following existing `vi.mock` pattern):

- Happy path: minimal HTML → bytes begin with `%PDF`
- CORS failure: one image fetch throws → function resolves, failures set populated
- PNG fallback: `convertToBlob` returns `image/png` → `embedPng` called
- Multi-page: canvas height = 2× A4 → 2-page PDF
- Empty HTML → valid single-page PDF
- Iframe cleanup: html2canvas-pro throws → no `<iframe>` remains in `document.body`

**E2E** (`e2e/`, Playwright, Chromium):
Create a minimal static HTML fixture (inline styles, one heading, one paragraph, no remote resources). Drag-drop it onto the editor. Assert via `page.evaluate()` against the Zustand store that: (1) `numPages === 1`, (2) `file.name` ends in `.pdf`, (3) no loading spinner is visible. Do **not** use `screenshot` or `read_page` — pdf.js keeps the page busy and those tools time out on this app (documented in CLAUDE.md memory).

---

## 7. Open Questions — resolved

**1. Auto-compress after multi-HTML merge?** → **Auto-shrink at generation time, not export time.**
`compressEditedPdf()` lossily rewrites the whole open document (including pages from a user's original PDF), so it is the wrong thing to auto-trigger. Instead each converted HTML gets a 20 MB budget (`MAX_HTML_PDF_BYTES` in `src/lib/htmlToPdf.ts`): when the assembled PDF exceeds it, the pages are re-encoded once at JPEG quality 0.6, and if it is still over, a toast points the user at the manual Compress action.

**2. html2canvas-pro bus risk — vendor from the start?** → **No.** The repo's existing posture accepts single-maintainer dependencies (heic-to). Revisit (pin/vendor/swap) only if the fork stalls.

**3. Architectural seam for future selectable-text output?** → **Built.** `htmlToPdf` is two exported stages: `renderHtmlToCanvas()` (HTML → capture canvas) and `assemblePdfWithinBudget()` (canvas → paged PDF bytes). A future DOM-serializer backend replaces the pair without touching the conversion routing.

**4. User-facing quality controls?** → **Fixed defaults in v1** (scale 2, JPEG 0.88, fallback 0.6). Add a setting only if users ask.
