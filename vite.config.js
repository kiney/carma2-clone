import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      output: { manualChunks: { renderer: ["three"], tiff: ["utif"] } },
    },
  },
});
