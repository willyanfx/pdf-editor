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
  lint: { options: { typeAware: true, typeCheck: true } },
});
