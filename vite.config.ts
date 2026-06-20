import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

const env = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

// SharedArrayBuffer (used by the OCR WASM/threads) requires the page to be
// cross-origin isolated, which needs these two response headers. Applied to the
// dev and preview servers so `crossOriginIsolated` is true locally and in the
// Playwright smoke tests. (GitHub Pages can't set these — the deployed app falls
// back to single-threaded OCR, which still works.)
const CROSS_ORIGIN_ISOLATION_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Spread as a loosely-typed partial so these keys don't enlarge the literal
// `defineConfig` infers — adding them inline overflows TS's overload-comparison
// depth for vite-plus's config type. The values are plain vite/vitest options.
const serverPreviewAndTest = {
  server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  // Keep the Playwright e2e specs out of the unit (vitest) runner — they use
  // @playwright/test and are driven by `pnpm test:e2e` instead.
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
} as Record<string, unknown>;

// `base` must match the GitHub Pages project path: https://<user>.github.io/pdf-editor/
// Override at build time with VITE_BASE if your repo name differs.
export default defineConfig({
  base: env?.VITE_BASE ?? "/pdf-editor/",
  plugins: [react()],
  ...serverPreviewAndTest,
  // react-draggable (via react-rnd) reads `process.env.DRAGGABLE_DEBUG` at
  // runtime; the browser has no `process`, so shim it to avoid a ReferenceError
  // that crashes the drag handlers.
  define: {
    "process.env.DRAGGABLE_DEBUG": "false",
  },
  // @huggingface/transformers (Transformers.js) loads its ONNX runtime via
  // dynamic WASM imports that esbuild's pre-bundler mangles — exclude it so the
  // Florence-2 VLM OCR worker can import it correctly.
  //
  // @paddleocr/paddleocr-js statically default-imports three CommonJS packages
  // (`import x from "clipper-lib" | "js-yaml" | "@techstark/opencv-js"`). Native
  // ESM can't synthesize a `default` from CJS, so these MUST be pre-bundled by
  // esbuild (which adds the interop) — force-include the package and those deps,
  // or the browser throws "does not provide an export named 'default'".
  // onnxruntime-web is the exception: paddle loads it via dynamic `import()` with
  // the same WASM shape as transformers, so it stays excluded.
  optimizeDeps: {
    include: ["@paddleocr/paddleocr-js", "clipper-lib", "js-yaml", "@techstark/opencv-js"],
    exclude: ["@huggingface/transformers", "onnxruntime-web"],
  },
  // The VLM OCR worker uses ES `import`s, so workers must be emitted as ESM for
  // the `{ type: "module" }` Worker to load after a production build.
  worker: {
    format: "es",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
});
