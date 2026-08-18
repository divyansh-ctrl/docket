import { builtinModules } from "node:module";
import { defineConfig } from "vite";

/**
 * The headless gate, bundled.
 *
 * The main process is bundled because its modules import each other without
 * file extensions, which Node cannot resolve on its own. The CLI shares those
 * modules -- deliberately, since the whole point is that a build machine and
 * the desktop app run the same code -- so it inherits the same requirement.
 *
 * Nothing Electron is reachable from this entry point. If that ever stops
 * being true the bundle will fail here rather than at the first CI run, which
 * is the earliest anyone could find out.
 */
export default defineConfig({
  build: {
    // Without this Vite builds for a browser, and "browser" means every node
    // builtin is replaced by an empty stub. The bundle then builds cleanly,
    // ships, and dies on its first call with `promisify is not a function`.
    // It did exactly that once before this line existed.
    ssr: true,
    outDir: "dist-cli",
    emptyOutDir: true,
    target: "node22",
    lib: {
      entry: "src/cli/main.ts",
      fileName: () => "docket-check.cjs",
      formats: ["cjs"],
    },
    rollupOptions: {
      // In SSR lib mode `lib.fileName` is ignored, so the name is set here.
      output: { entryFileNames: "docket-check.cjs" },
      external: [
        "electron",
        "node-pty",
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
    },
  },
});
