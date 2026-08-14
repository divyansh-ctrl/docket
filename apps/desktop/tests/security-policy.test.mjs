import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  assertAllowlistedCommand,
  isAllowlistedDocsUrl,
  isTrustedRendererUrl,
  parseAllowlistedDocsUrl,
} = jiti(fileURLToPath(new URL("../src/main/security-policy.ts", import.meta.url)));

test("provider commands are fixed allowlists with no resume or shell arguments", () => {
  assert.doesNotThrow(() => assertAllowlistedCommand("codex", "login", ["login"]));
  assert.doesNotThrow(() =>
    assertAllowlistedCommand("claude", "login", ["auth", "login", "--console"]),
  );
  assert.doesNotThrow(() =>
    assertAllowlistedCommand("claude", "login", ["auth", "login", "--claudeai"]),
  );
  assert.doesNotThrow(() => assertAllowlistedCommand("codex", "session", []));
  assert.doesNotThrow(() => assertAllowlistedCommand("claude", "session", []));

  assert.throws(() => assertAllowlistedCommand("claude", "session", ["--continue"]));
  assert.throws(() => assertAllowlistedCommand("claude", "session", ["--resume", "latest"]));
  assert.throws(() => assertAllowlistedCommand("claude", "login", ["auth", "login"]));
  assert.throws(() => assertAllowlistedCommand("codex", "session", ["--", "/bin/zsh"]));
});

test("renderer trust is exact for packaged files and bound to one dev origin", () => {
  const packaged = "file:///Applications/Docket.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html";
  assert.equal(isTrustedRendererUrl(packaged, packaged), true);
  assert.equal(isTrustedRendererUrl(`${packaged}#changed`, packaged), false);
  assert.equal(isTrustedRendererUrl("file:///tmp/index.html", packaged), false);

  const dev = "http://127.0.0.1:5173/";
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/activity", dev), true);
  assert.equal(isTrustedRendererUrl("http://localhost:5173/activity", dev), false);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5174/activity", dev), false);
});

test("external links are restricted to credential-free HTTPS documentation hosts", () => {
  assert.equal(isAllowlistedDocsUrl("https://developers.openai.com/codex/"), true);
  assert.equal(isAllowlistedDocsUrl("https://docs.anthropic.com/en/docs/claude-code"), true);
  assert.equal(isAllowlistedDocsUrl("https://evil.docs.anthropic.com/"), false);
  assert.equal(isAllowlistedDocsUrl("http://docs.anthropic.com/"), false);
  assert.equal(isAllowlistedDocsUrl("https://user:secret@docs.anthropic.com/"), false);
  assert.throws(() => parseAllowlistedDocsUrl("javascript:alert(1)"));
});
