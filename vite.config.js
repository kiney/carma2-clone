import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
export default defineConfig({
  plugins: [
    {
      name: "distribution-license-notices",
      generateBundle() {
        for (const [sourceFile, fileName] of [
          ["LICENSE", "LICENSE.txt"],
          ["THIRD_PARTY_LICENSES.txt", "THIRD_PARTY_LICENSES.txt"],
        ]) {
          this.emitFile({
            type: "asset",
            fileName,
            source: readFileSync(new URL(sourceFile, import.meta.url), "utf8"),
          });
        }
      },
    },
  ],
  build: {
    rollupOptions: {
      output: { manualChunks: { renderer: ["three"], tiff: ["utif"] } },
    },
  },
});
