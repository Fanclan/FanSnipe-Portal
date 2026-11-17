import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { canonicalSite } from "../config/site.mjs";
export default defineConfig({
  root: resolve("dashboard"),
  define: {
    __PUBLIC_SITE_URL__: JSON.stringify(canonicalSite()),
  },
  base: "./",
  plugins: [react()],
  build: {
    license: { fileName: "licenses/dependencies.md" },
    outDir: resolve("dist-dashboard"),
    emptyOutDir: true,
  },
});
