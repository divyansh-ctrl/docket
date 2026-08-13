import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/index.ts",
      fileName: () => "main.js",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["electron", "node-pty"],
    },
  },
});
