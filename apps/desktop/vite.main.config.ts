import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/index.ts",
      // .cjs, not .js: the package declares "type": "module", so Node parses a
      // .js file as ESM and the CommonJS output Vite emits here dies on its
      // first require(). The app did not start at all until this was fixed.
      fileName: () => "main.cjs",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["electron", "node-pty"],
    },
  },
});
