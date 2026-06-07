import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

// `base` must match the GitHub Pages project path: https://<user>.github.io/pdf-editor/
// Override at build time with VITE_BASE if your repo name differs.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/pdf-editor/",
  plugins: [react()],
  lint: { options: { typeAware: true, typeCheck: true } },
});
