import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

const env = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

// `base` must match the GitHub Pages project path: https://<user>.github.io/pdf-editor/
// Override at build time with VITE_BASE if your repo name differs.
export default defineConfig({
  base: env?.VITE_BASE ?? "/pdf-editor/",
  plugins: [react()],
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
