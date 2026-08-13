// The desktop app ships for macOS, Linux, and Windows, but each CI runner can
// only execute one of them. Every layout decision is therefore a pure function
// of an explicit platform context, so all three are exercised from any host.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  isAllowedExecutableDirectory,
  isTrustedProviderLayout,
  providerEnvironment,
  providerLayout,
  safeProviderEnvironment,
} = jiti(fileURLToPath(new URL("../src/main/platform-layout.ts", import.meta.url)));

const MAC = Object.freeze({ platform: "darwin", home: "/Users/dev" });
const LINUX = Object.freeze({ platform: "linux", home: "/home/dev" });
const WINDOWS = Object.freeze({ platform: "win32", home: "C:\\Users\\dev" });

test("macOS accepts the native and Homebrew Claude layouts, including the latest cask", () => {
  assert.equal(
    isTrustedProviderLayout(
      "claude",
      "/Users/dev/.local/bin/claude",
      "/Users/dev/.local/share/claude/versions/2.1.231",
      MAC,
    ),
    true,
  );
  assert.equal(
    isTrustedProviderLayout(
      "claude",
      "/opt/homebrew/bin/claude",
      "/opt/homebrew/Caskroom/claude-code/2.1.231/claude",
      MAC,
    ),
    true,
  );
  // Homebrew publishes a second cask that tracks the latest channel.
  assert.equal(
    isTrustedProviderLayout(
      "claude",
      "/opt/homebrew/bin/claude",
      "/opt/homebrew/Caskroom/claude-code@latest/2.1.231/claude",
      MAC,
    ),
    true,
  );
});

test("macOS still accepts the NVM Codex layout and rejects lookalikes", () => {
  const invocation = "/Users/dev/.nvm/versions/node/v20.11.1/bin/codex";
  assert.equal(
    isTrustedProviderLayout(
      "codex",
      invocation,
      "/Users/dev/.nvm/versions/node/v20.11.1/lib/node_modules/@openai/codex/bin/codex.js",
      MAC,
    ),
    true,
  );
  assert.equal(
    isTrustedProviderLayout("codex", invocation, "/Users/dev/.nvm/malicious/codex.js", MAC),
    false,
  );
  assert.equal(
    isTrustedProviderLayout(
      "codex",
      "/Users/dev/.nvm/versions/node/v20.11.1/untrusted/bin/codex",
      "/Users/dev/.nvm/versions/node/v20.11.1/lib/node_modules/@openai/codex/bin/codex.js",
      MAC,
    ),
    false,
  );
});

test("Linux accepts package-manager and native Claude installs", () => {
  // apt, dnf, and apk install a real binary that resolves to itself.
  assert.equal(isTrustedProviderLayout("claude", "/usr/bin/claude", "/usr/bin/claude", LINUX), true);
  assert.equal(
    isTrustedProviderLayout(
      "claude",
      "/home/dev/.local/bin/claude",
      "/home/dev/.local/share/claude/versions/2.1.231",
      LINUX,
    ),
    true,
  );
  // A launcher in a trusted directory may not point outside a trusted root.
  assert.equal(
    isTrustedProviderLayout("claude", "/usr/bin/claude", "/tmp/evil/claude", LINUX),
    false,
  );
});

test("Linux resolves Codex from the standard npm prefixes", () => {
  assert.equal(
    isTrustedProviderLayout(
      "codex",
      "/usr/local/bin/codex",
      "/usr/local/lib/node_modules/@openai/codex/bin/codex.js",
      LINUX,
    ),
    true,
  );
  assert.equal(
    isTrustedProviderLayout(
      "codex",
      "/usr/local/bin/codex",
      "/home/dev/evil/node_modules/@openai/codex/bin/codex.js",
      LINUX,
    ),
    false,
  );
});

test("Windows accepts the .exe and .cmd launchers the installers actually create", () => {
  assert.equal(
    isTrustedProviderLayout(
      "claude",
      "C:\\Users\\dev\\.local\\bin\\claude.exe",
      "C:\\Users\\dev\\.local\\share\\claude\\2.1.231.exe",
      WINDOWS,
    ),
    true,
  );
  // npm's global shim is a real file, so it resolves to itself.
  assert.equal(
    isTrustedProviderLayout(
      "codex",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd",
      WINDOWS,
    ),
    true,
  );
  assert.equal(
    isTrustedProviderLayout(
      "claude",
      "C:\\Users\\dev\\Downloads\\claude.exe",
      "C:\\Users\\dev\\Downloads\\claude.exe",
      WINDOWS,
    ),
    false,
  );
});

test("Windows path comparison ignores case, as the filesystem does", () => {
  assert.equal(
    isTrustedProviderLayout(
      "claude",
      "C:\\USERS\\dev\\.local\\bin\\CLAUDE.EXE",
      "C:\\Users\\dev\\.local\\share\\claude\\2.1.231.exe",
      WINDOWS,
    ),
    true,
  );
  assert.equal(
    isAllowedExecutableDirectory("codex", "c:\\users\\dev\\appdata\\roaming\\npm", WINDOWS),
    true,
  );
});

test("a POSIX launcher name is never accepted on Windows and vice versa", () => {
  assert.deepEqual(providerLayout("codex", WINDOWS).fileNames, ["codex.cmd", "codex.exe"]);
  assert.deepEqual(providerLayout("codex", LINUX).fileNames, ["codex"]);
  assert.equal(
    isTrustedProviderLayout(
      "codex",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex",
      WINDOWS,
    ),
    false,
  );
});

test("untrusted directories are refused on every platform", () => {
  assert.equal(isAllowedExecutableDirectory("codex", "/tmp/bin", MAC), false);
  assert.equal(isAllowedExecutableDirectory("claude", "/tmp/bin", LINUX), false);
  assert.equal(isAllowedExecutableDirectory("claude", "C:\\Temp", WINDOWS), false);
  // Claude never runs from an NVM directory; only Codex does.
  assert.equal(
    isAllowedExecutableDirectory("claude", "/Users/dev/.nvm/versions/node/v20.11.1/bin", MAC),
    false,
  );
});

test("the child environment is built from scratch on every platform", () => {
  const poisoned = {
    PATH: "/untrusted/bin",
    SHELL: "/untrusted/shell",
    HOME: "/Users/dev",
    SystemRoot: "C:\\Windows",
    NODE_OPTIONS: "--require /untrusted/pwn.js",
  };

  const unix = providerEnvironment("/trusted/provider", "/trusted/runtime", MAC, poisoned);
  assert.equal(unix.PATH, "/trusted/runtime:/trusted/provider:/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(unix.SHELL, undefined);
  assert.equal(unix.NODE_OPTIONS, undefined);

  const windows = providerEnvironment("C:\\provider", "C:\\runtime", WINDOWS, poisoned);
  assert.equal(
    windows.PATH,
    "C:\\runtime;C:\\provider;C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\Wbem",
  );
  assert.equal(windows.NODE_OPTIONS, undefined);
  // Without SystemRoot, Windows cannot start a process at all.
  assert.equal(windows.SystemRoot, "C:\\Windows");
  assert.equal(safeProviderEnvironment(WINDOWS, poisoned).HOME, undefined);
});
