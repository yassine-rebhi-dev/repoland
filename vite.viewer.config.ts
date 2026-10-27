import { defineConfig } from "vite";

/** Builds the 3D viewer as one self-contained script (three.js bundled) exposing window.Repoland.mount. */
export default defineConfig({
  build: {
    outDir: "dist/viewer",
    emptyOutDir: true,
    lib: { entry: "viewer/index.ts", name: "Repoland", formats: ["iife"], fileName: () => "repoland-viewer.js" },
    minify: true,
  },
});
