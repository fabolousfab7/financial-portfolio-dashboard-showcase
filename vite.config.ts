import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  // GitHub Pages serves the demo under /<repo>/; local dev and Vercel use "/".
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
