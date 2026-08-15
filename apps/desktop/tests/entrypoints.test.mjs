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

test("every built artifact name carries the version", async () => {
  const manifest = JSON.parse(await read("package.json"));
  const config = await read("forge.config.ts");

  // Docket-Setup.exe was byte-identical in name across two releases, so which
  // build a download resolved to depended on release ordering rather than on
  // what was asked for. A name without a version is the whole failure.
  const setupExe = /setupExe:\s*`([^`]+)`/.exec(config)?.[1] ?? /setupExe:\s*"([^"]+)"/.exec(config)?.[1];
  assert.ok(setupExe, "the Windows installer should be named explicitly");
  assert.ok(
    setupExe.includes("${VERSION}") || setupExe.includes(manifest.version),
    `setupExe is ${setupExe}, which does not change between versions; two releases would collide`,
  );
});

// The app crashed with a dialog on every window close: Electron's "closed"
// event fires *after* the window and its webContents are destroyed, and the
// handler read `window.webContents.id` to tell the PTY manager whose sessions
// to stop. That threw "Object has been destroyed", so the sessions it existed
// to clean up were left running.
//
// Nothing caught it, because the main process is not exercised by any test that
// can open a window. This checks the shape instead: the id has to be captured
// while the window is alive.
test("the closed handler does not touch webContents after destruction", async () => {
  const source = await read("src/main/index.ts");

  const closedHandler = /window\.on\("closed",[\s\S]*?\n {2}\}\);/.exec(source);
  assert.ok(closedHandler, "expected a closed handler to exist");
  assert.doesNotMatch(
    closedHandler[0],
    /window\.webContents/,
    'the "closed" handler must use an id captured earlier, not window.webContents',
  );

  assert.match(
    source,
    /const webContentsId = window\.webContents\.id;/,
    "the webContents id should be captured while the window is alive",
  );
});

// Same failure mode, reached from the other direction: a check can still be
// streaming output when the window goes away.
test("renderer sends are guarded on both the window and its webContents", async () => {
  const source = await read("src/main/ipc-handlers.ts");

  const sends = [...source.matchAll(/webContents\.send\(/g)];
  assert.equal(sends.length, 1, "all renderer sends should go through one guarded helper");

  assert.match(source, /if \(mainWindow\.isDestroyed\(\)\) return;/);
  assert.match(source, /if \(mainWindow\.webContents\.isDestroyed\(\)\) return;/);
});
