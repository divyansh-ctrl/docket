import assert from "node:assert/strict";
import { test } from "node:test";
import process from "node:process";
import { spawn } from "node-pty";

test("the prepared macOS PTY helper launches a fixed harmless process", {
  skip: process.platform !== "darwin" || process.arch !== "arm64",
}, async () => {
  const result = await new Promise((resolve, reject) => {
    let output = "";
    let terminal;
    try {
      terminal = spawn("/usr/bin/printf", ["docket-pty-ok\\n"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: "/private/tmp",
        env: { PATH: "/usr/bin:/bin" },
      });
    } catch (error) {
      reject(error);
      return;
    }
    terminal.onData((data) => { output += data; });
    terminal.onExit(({ exitCode }) => resolve({ exitCode, output }));
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /docket-pty-ok/);
});
