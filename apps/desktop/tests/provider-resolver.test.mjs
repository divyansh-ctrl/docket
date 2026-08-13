import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { isTrustedProviderLayout, parseClaudeAuthStatus, providerEnvironment } = jiti(
  fileURLToPath(new URL("../src/main/provider-resolver.ts", import.meta.url)),
);

test("provider provenance accepts canonical layouts and rejects nested NVM lookalikes", () => {
  const home = process.env.HOME;
  assert.ok(home, "HOME is required for provider path tests");
  const codexInvocation = `${home}/.nvm/versions/node/v20.11.1/bin/codex`;
  const codexTarget = `${home}/.nvm/versions/node/v20.11.1/lib/node_modules/@openai/codex/bin/codex.js`;
  const claudeInvocation = `${home}/.local/bin/claude`;
  const claudeTarget = `${home}/.local/share/claude/versions/2.1.231`;
  assert.equal(isTrustedProviderLayout("codex", codexInvocation, codexTarget), true);
  assert.equal(isTrustedProviderLayout("claude", claudeInvocation, claudeTarget), true);
  assert.equal(
    isTrustedProviderLayout(
      "codex",
      `${home}/.nvm/versions/node/v20.11.1/untrusted/bin/codex`,
      codexTarget,
    ),
    false,
  );
  assert.equal(
    isTrustedProviderLayout("codex", codexInvocation, `${home}/.nvm/malicious/codex.js`),
    false,
  );
});

test("Claude status parsing keeps only method and login state", () => {
  assert.deepEqual(
    parseClaudeAuthStatus(JSON.stringify({
      loggedIn: true,
      authMethod: "claudeAiOauth",
      email: "must-not-leak@example.com",
      token: "must-not-leak",
    })),
    { loggedIn: true, authMethod: "claudeaioauth" },
  );
  assert.deepEqual(
    parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"console"}'),
    { loggedIn: true, authMethod: "console" },
  );
  assert.equal(parseClaudeAuthStatus("not json"), null);
});

test("child environment never inherits a caller supplied PATH or shell", () => {
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;
  process.env.PATH = "/untrusted/bin";
  process.env.SHELL = "/untrusted/shell";
  try {
    const environment = providerEnvironment("/trusted/provider", "/trusted/runtime");
    assert.equal(environment.PATH, "/trusted/runtime:/trusted/provider:/usr/bin:/bin:/usr/sbin:/sbin");
    assert.equal(environment.SHELL, undefined);
  } finally {
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
  }
});
