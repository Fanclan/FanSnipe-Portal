import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("dashboard"),
  define: {
    __PUBLIC_SITE_URL__: JSON.stringify(
      process.env.PUBLIC_SITE_URL ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : ""),
    ),
  },
  base: "./",
  plugins: [react()],
  build: { outDir: resolve("dist-dashboard"), emptyOutDir: true },
});
