import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3210",
      "/pdfjs": "http://127.0.0.1:3210",
    },
  },
  build: { target: "esnext", chunkSizeWarningLimit: 4000 },
});
