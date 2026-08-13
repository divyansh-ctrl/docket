import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    // Packaged builds ship no sourcemap: it added ~1.7 MB to every download
    // and exposed the renderer's original sources.
    sourcemap: mode !== "production",
  },
}));
