# VLM OCR (Florence-2 + Transformers.js + WebGPU)

A second OCR engine alongside the default tesseract.js path. It runs the
**Florence-2** vision-language model entirely in the browser on **WebGPU** via
**Transformers.js**, extracting text **with per-region layout boxes** and
estimating a font size for each box.

## Why Florence-2 and not SmolVLM

The feature was originally scoped around SmolVLM-256M/500M. Research (grounded,
cited — see the project memory note `smolvlm-no-bbox-use-florence2`) showed
SmolVLM has **zero grounding capability** (box-localization AP@0.5 ≈ 0.005): it
can transcribe free-form text but cannot tell you *where* text is on the page.
Since this feature needs layout extraction and font-size-from-bounding-boxes,
SmolVLM literally can't deliver it.

`onnx-community/Florence-2-base-ft` is the one Transformers.js-native model that
returns text **and** quad boxes (via the `<OCR_WITH_REGION>` task). ~275 MB at
mixed q4/fp16, official WebGPU demo exists. That's the engine we use.

## Architecture

```
ToolRail (Sparkles toggle) ──sets──▶ store.ocrEngine = "florence2"
                                       │
OcrLayer / PdfViewer (3 call-sites) ──▶ recognizeWithEngine(engine, canvas, …)   [dispatch.ts]
                                       │  engine==="florence2"
                                       ▼
                               recognizePageRegionVlm(canvas, …)                  [index.ts]
                                 - crop canvas → ImageBitmap (transferred)
                                 - postMessage to worker
                                 - map image-px quads → screen px
                                 - estimate font size + bold per region
                                       │
                                       ▼
                               florence2.worker.ts  (Web Worker, ESM)
                                 - load Florence-2 on WebGPU (singleton, cached)
                                 - <OCR_WITH_REGION> → { quad_boxes, labels }
```

`recognizePageRegionVlm` has the **same signature** as tesseract's
`recognizePageRegion` and returns the same `ScreenTextItem[]`, so the existing
OCR consumers (region drag, whole-page, whole-document) light up unchanged — they
just route through `dispatch.ts`.

## Files

| File | Role |
|---|---|
| `types.ts` | shared types + worker message protocol + model id / task constants |
| `env.ts` | tiny `isWebGpuAvailable()` probe — **no** transformers import (keeps it out of the main bundle) |
| `florence2.worker.ts` | the Web Worker: model load + inference on WebGPU |
| `index.ts` | main-thread client: worker plumbing, crop, projection, font sizing |
| `fontSize.ts` | **font-size-from-bbox estimation** (the custom geometry) |
| `dispatch.ts` | picks tesseract vs florence2 by `store.ocrEngine` |
| `fontSize.test.ts`, `projection.test.ts` | unit tests for the geometry/projection |

## Font-size estimation (`fontSize.ts`)

Florence-2 boxes carry no font metrics, so size is recovered from geometry:

1. **Quad → visual line height.** A quad can be rotated; the line height is the
   *minor* axis of the quad (`quadDimensions`), not the axis-aligned bbox height.
2. **Line count.** A region may wrap several lines; we take the max of a
   geometric estimate (height ÷ lineHeight) and a textual one (chars ÷
   chars-per-line) so a tall block doesn't yield a giant font.
3. **Font size** = perLineHeight / 1.2 (the editor's `height = fontSize * 1.2`
   convention), clamped to a sane on-screen range.
4. **Bold** is inferred from *relative* size: a region ≥ 1.35× the page-median
   font reads as a heading (Florence-2 gives no weight, and unlike the tesseract
   path there's no greyscale canvas to measure ink density on).

## Dtype / WebGPU selection

In the worker: detect `navigator.gpu` and the `shader-f16` adapter feature.
- WebGPU + fp16 → mixed dtype: `vision_encoder`/`embed_tokens` fp16, encoder/
  decoder q4 (vision encoder is the most quantization-sensitive).
- WebGPU without fp16 → uniform `q4`.
- No WebGPU → `wasm` device, `q8`.

## Build / hosting notes

- `vite.config.ts`: `optimizeDeps.exclude: ["@huggingface/transformers"]` (its
  dynamic WASM imports break esbuild pre-bundling) and `worker.format: "es"` (the
  worker uses ESM imports).
- The model downloads once (~275 MB) and is cached in the browser **Cache API**
  by Transformers.js; reloads are instant.
- **COOP/COEP headers are *not* required** here. They're only needed for the WASM
  *multi-threaded* fallback (SharedArrayBuffer). The primary path is WebGPU; the
  WASM fallback runs single-threaded without cross-origin isolation. That matters
  because this app deploys to **GitHub Pages**, which can't set custom headers.

## Honest limitations

- First OCR is gated on a multi-hundred-MB download (progress is surfaced via a
  toast + the OCR progress bar).
- Florence-2-base is a small model; expect errors on dense/scanned pages and
  weaker results on non-Latin/handwritten text. For clean digital PDF renders at
  `VIEWER_WIDTH` it does well and — unlike tesseract — yields layout boxes.
- Inference isn't incrementally reported (one-shot generation), so the progress
  bar jumps to 100 % once decoding starts.
