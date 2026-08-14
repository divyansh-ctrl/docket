// The app shipped a release that could not start: Vite emits CommonJS for the
// main and preload processes, package.json declares "type": "module", and Node
// therefore parsed .js output as ESM and threw on the first require(). Nothing
// caught it because the renderer is verified in a browser, where neither file
// is involved.
//
// These assertions are the cheapest guard against a repeat: they check the
// agreement between the module type, the built filenames, and the entry point,
// which is where the mistake actually lives.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = async (path) => readFile(fileURLToPath(new URL(path, root)), "utf8");

test("the declared entry point matches the module type", async () => {
  const manifest = JSON.parse(await read("package.json"));

  if (manifest.type === "module") {
    assert.ok(
      manifest.main.endsWith(".cjs"),
      `package.json main is ${manifest.main}, but "type": "module" makes Node parse .js as ESM; ` +
        "CommonJS output has to be named .cjs or the app throws before any of its own code runs",
    );
  }
});

test("the main process is built to the name the entry point expects", async () => {
  const manifest = JSON.parse(await read("package.json"));
  const config = await read("vite.main.config.ts");

  const emitted = /fileName:\s*\(\)\s*=>\s*"([^"]+)"/.exec(config)?.[1];
  assert.ok(emitted, "vite.main.config.ts should name its output explicitly");
  assert.ok(
    manifest.main.endsWith(emitted),
    `vite emits ${emitted} but package.json points at ${manifest.main}`,
  );

  // A CommonJS build under "type": "module" must carry the .cjs extension.
  if (/formats:\s*\[\s*"cjs"\s*\]/.test(config) && manifest.type === "module") {
    assert.ok(emitted.endsWith(".cjs"), `${emitted} is CommonJS output and needs the .cjs extension`);
  }
});

test("the preload is built and referenced under the same name", async () => {
  const config = await read("vite.preload.config.ts");
  const main = await read("src/main/index.ts");

  const emitted = /entryFileNames:\s*"([^"]+)"/.exec(config)?.[1];
  assert.ok(emitted, "vite.preload.config.ts should name its output explicitly");
  assert.ok(
    main.includes(`"${emitted}"`),
    `the preload is built as ${emitted}, but src/main/index.ts does not reference that name; ` +
      "a mismatch here loads no preload at all and every IPC call fails at runtime",
  );
});
