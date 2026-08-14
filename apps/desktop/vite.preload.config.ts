import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron"],
      output: {
        // Same reason as the main process: CommonJS output needs the .cjs
        // extension under "type": "module".
        entryFileNames: "preload.cjs",
        format: "cjs",
      },
    },
  },
});
