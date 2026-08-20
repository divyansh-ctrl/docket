import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  CODEX_REGION_BEGIN,
  CODEX_REGION_END,
  fromClaudeCode,
  fromCodex,
  renderClaudeCode,
  spliceCodexRegion,
  toClaudeCode,
  toCodex,
} = jiti("../src/shared/mcp-config.ts");

const lossFor = (losses, field) => losses.find((loss) => loss.field === field);
const noteFor = (notes, field) => notes.find((note) => note.field === field);

// --- the invariant -------------------------------------------------------

test("no .mcp.json entry ever carries a url without a type", () => {
  // Claude Code skips such an entry. It says why, but only in `claude mcp
  // list`, which nobody runs until something is already broken.
  const { config } = toClaudeCode([
    { id: "a", transport: "http", url: "https://e.com/mcp" },
    { id: "b", transport: "sse", url: "https://e.com/sse" },
    { id: "c", transport: "ws", url: "wss://e.com/ws" },
    { id: "d", transport: "stdio", command: "echo" },
  ]);
  for (const [id, entry] of Object.entries(config.mcpServers)) {
    assert.ok(entry.type, `${id} was written without a type`);
    if (entry.url) assert.ok(["http", "sse", "ws"].includes(entry.type), `${id} has a url and type ${entry.type}`);
  }
});

test("stdio entries state their transport rather than leaving it inferred", () => {
  const { config } = toClaudeCode([{ id: "a", transport: "stdio", command: "echo" }]);
  assert.equal(config.mcpServers.a.type, "stdio");
});

// --- Claude Code losses --------------------------------------------------

test("a tool allowlist that cannot be carried is reported as weakened, not dropped", () => {
  // The whole point of the severity split: this is a security control
  // disappearing, and it must not read like a formatting preference.
  const { losses } = toClaudeCode([
    { id: "a", transport: "stdio", command: "echo", enabledTools: ["read_file"], disabledTools: ["rm_rf"] },
  ]);
  assert.equal(lossFor(losses, "enabledTools").severity, "weakened");
  assert.equal(lossFor(losses, "disabledTools").severity, "weakened");
  assert.match(lossFor(losses, "enabledTools").detail, /read_file/);
});

test("a disabled server is left out of .mcp.json rather than written on", () => {
  // Claude Code accepts an `enabled` key and drops it, so writing the entry
  // would run a server that was switched off.
  const { config, omitted, losses } = toClaudeCode([
    { id: "off", transport: "stdio", command: "echo", enabled: false },
    { id: "on", transport: "stdio", command: "echo" },
  ]);
  assert.deepEqual(Object.keys(config.mcpServers), ["on"]);
  assert.deepEqual(omitted, ["off"]);
  assert.equal(lossFor(losses, "enabled").server, "off");
});

test("a credential held in an environment variable is never inlined to make it fit", () => {
  // The translation exists -- resolve the variable, write the literal -- and it
  // would put a live credential in a file meant to be committed.
  const { config, losses } = toClaudeCode([
    {
      id: "a",
      transport: "http",
      url: "https://e.com/mcp",
      bearerTokenEnvVar: "TOKEN",
      envHeaders: { "X-Key": "SECRET_ENV" },
    },
  ]);
  const serialised = JSON.stringify(config);
  assert.doesNotMatch(serialised, /TOKEN|SECRET_ENV|Authorization/i);
  assert.equal(lossFor(losses, "bearerTokenEnvVar").severity, "unsupported");
  assert.equal(lossFor(losses, "envHeaders").severity, "unsupported");
});

test("Codex-only conveniences are reported as merely dropped", () => {
  const { losses } = toClaudeCode([
    { id: "a", transport: "stdio", command: "echo", cwd: "/tmp", envVars: ["PATH"], startupTimeoutSec: 25 },
  ]);
  for (const field of ["cwd", "envVars", "startupTimeoutSec"]) {
    assert.equal(lossFor(losses, field).severity, "dropped", `${field} should not be alarming`);
  }
});

test("losses are ordered worst first", () => {
  const { losses } = toClaudeCode([
    { id: "a", transport: "http", url: "https://e.com", bearerTokenEnvVar: "T", enabledTools: ["x"], startupTimeoutSec: 9 },
  ]);
  assert.deepEqual(
    losses.map((loss) => loss.severity),
    ["unsupported", "weakened", "dropped"],
  );
});

// --- Codex ---------------------------------------------------------------

test("an sse or ws server is not written to Codex at all", () => {
  // Codex ignores the transport key and reaches for streamable HTTP, so the
  // entry would look configured and fail only when an agent used it.
  const { region, omitted, losses } = toCodex([
    { id: "streamed", transport: "sse", url: "https://e.com/sse" },
    { id: "socket", transport: "ws", url: "wss://e.com/ws" },
    { id: "fine", transport: "http", url: "https://e.com/mcp" },
  ]);
  assert.deepEqual([...omitted].sort(), ["socket", "streamed"]);
  assert.doesNotMatch(region, /e\.com\/sse|e\.com\/ws/);
  assert.match(region, /e\.com\/mcp/);
  assert.equal(losses.filter((loss) => loss.severity === "unsupported").length, 2);
});

test("sub-tables are written after every bare key of their parent", () => {
  // TOML reads keys after a sub-table header as belonging to the sub-table, so
  // an env block emitted early would swallow everything following it.
  const { region } = toCodex([
    { id: "a", transport: "stdio", command: "npx", args: ["-y", "s"], env: { K: "v" }, toolTimeoutSec: 90 },
  ]);
  assert.ok(region.indexOf("tool_timeout_sec") < region.indexOf("[mcp_servers.a.env]"));
});

test("strings that would break the file are escaped", () => {
  const { region } = toCodex([
    { id: "a", transport: "stdio", command: 'say "hi"\\then', args: ["a\nb", "tab\there"] },
  ]);
  assert.match(region, /command = "say \\"hi\\"\\\\then"/);
  assert.match(region, /"a\\nb"/);
  assert.match(region, /"tab\\there"/);
});

test("an id that is not a bare TOML key is quoted", () => {
  const { region } = toCodex([{ id: "my.server", transport: "stdio", command: "echo" }]);
  assert.match(region, /\[mcp_servers\."my\.server"\]/);
});

// --- splicing ------------------------------------------------------------

test("splicing into a file without markers appends and keeps every other byte", () => {
  const existing = 'model = "gpt-5"\n\n[sandbox]\nmode = "workspace-write"\n';
  const out = spliceCodexRegion(existing, `${CODEX_REGION_BEGIN}\nx = 1\n${CODEX_REGION_END}`);
  assert.ok(out.startsWith(existing));
  assert.match(out, /x = 1/);
});

test("splicing twice replaces the region rather than stacking it", () => {
  const existing = 'model = "gpt-5"\n';
  const once = spliceCodexRegion(existing, `${CODEX_REGION_BEGIN}\na = 1\n${CODEX_REGION_END}`);
  const twice = spliceCodexRegion(once, `${CODEX_REGION_BEGIN}\nb = 2\n${CODEX_REGION_END}`);
  assert.equal(twice.match(new RegExp(CODEX_REGION_BEGIN, "g")).length, 1);
  assert.doesNotMatch(twice, /a = 1/);
  assert.match(twice, /b = 2/);
  assert.match(twice, /model = "gpt-5"/);
});

test("configuration around the region survives a replacement exactly", () => {
  const before = '# a comment a parser would discard\nmodel = "gpt-5"\n\n';
  const after = '\n[sandbox]\nmode = "read-only"\n';
  const once = spliceCodexRegion(`${before}${after}`, `${CODEX_REGION_BEGIN}\na = 1\n${CODEX_REGION_END}`);
  const twice = spliceCodexRegion(once, `${CODEX_REGION_BEGIN}\nb = 2\n${CODEX_REGION_END}`);
  assert.match(twice, /# a comment a parser would discard/);
  assert.match(twice, /mode = "read-only"/);
});

test("a half-written or reversed marker pair refuses rather than guessing", () => {
  // Guessing which half to trust means guessing which span of a person's Codex
  // configuration to delete.
  const region = `${CODEX_REGION_BEGIN}\na = 1\n${CODEX_REGION_END}`;
  assert.throws(() => spliceCodexRegion(`x = 1\n${CODEX_REGION_BEGIN}\n`, region), /without its pair/);
  assert.throws(() => spliceCodexRegion(`x = 1\n${CODEX_REGION_END}\n`, region), /without its pair/);
  assert.throws(() => spliceCodexRegion(`${CODEX_REGION_END}\n${CODEX_REGION_BEGIN}\n`, region), /wrong order/);
});

// --- import --------------------------------------------------------------

test("an untyped url is reported, not repaired by guessing a transport", () => {
  const { servers, problems } = fromClaudeCode({ mcpServers: { a: { url: "https://e.com/mcp" } } });
  assert.deepEqual(servers, []);
  assert.match(problems[0].detail, /http, sse or ws/);
});

test("reading Codex always says what that source cannot show", () => {
  // codex mcp list --json omits enabled_tools and disabled_tools, though
  // codex mcp get shows both. A restriction Docket cannot see is one it would
  // drop on the next write.
  const { problems } = fromCodex([]);
  assert.match(problems[0].detail, /enabled_tools or disabled_tools/);
  assert.equal(problems[0].server, null);
});

test("a Codex entry reads back into the canonical record", () => {
  const { servers } = fromCodex([
    {
      name: "s",
      enabled: true,
      transport: { type: "stdio", command: "npx", args: ["-y", "srv"], env: { K: "v" }, env_vars: ["PATH"], cwd: "/tmp" },
      startup_timeout_sec: 25.0,
      tool_timeout_sec: 90.0,
    },
  ]);
  assert.deepEqual(servers[0], {
    id: "s",
    transport: "stdio",
    command: "npx",
    args: ["-y", "srv"],
    cwd: "/tmp",
    env: { K: "v" },
    envVars: ["PATH"],
    enabled: true,
    startupTimeoutSec: 25,
    toolTimeoutSec: 90,
  });
});

test("a Claude Code file survives a round trip through the canonical record", () => {
  const original = {
    mcpServers: {
      remote: { type: "sse", url: "https://e.com/sse", headers: { "X-A": "b" } },
      local: { type: "stdio", command: "echo", args: ["hi"], env: { K: "v" } },
    },
  };
  const { servers, problems } = fromClaudeCode(original);
  assert.deepEqual(problems, []);
  assert.deepEqual(toClaudeCode(servers).config, original);
});

test("the same servers always render the same bytes", () => {
  const servers = [
    { id: "b", transport: "stdio", command: "echo", env: { Z: "1", A: "2" } },
    { id: "a", transport: "http", url: "https://e.com", headers: { Q: "1", B: "2" } },
  ];
  assert.equal(renderClaudeCode(toClaudeCode(servers).config), renderClaudeCode(toClaudeCode([...servers].reverse()).config));
  assert.equal(toCodex(servers).region, toCodex([...servers].reverse()).region);
});


// --- fields found only by checking the CLIs a second time ----------------
//
// The first version of this module reported all four of the below as losses.
// Each was wrong, and each was found by round-tripping against the installed
// CLIs rather than by re-reading the code.

test("a tool timeout is translated into Claude Code's units, not dropped", () => {
  const { config, notes, losses } = toClaudeCode([{ id: "a", transport: "stdio", command: "echo", toolTimeoutSec: 90 }]);
  assert.equal(config.mcpServers.a.timeout, 90_000);
  assert.match(noteFor(notes, "toolTimeoutSec").detail, /milliseconds/);
  assert.equal(lossFor(losses, "toolTimeoutSec"), undefined);
});

test("a timeout Claude Code would ignore is reported rather than written", () => {
  // Claude Code ignores anything under a second and falls back to its own
  // default, so writing it would show a setting that does nothing.
  const { config, losses } = toClaudeCode([{ id: "a", transport: "stdio", command: "echo", toolTimeoutSec: 0.5 }]);
  assert.equal(config.mcpServers.a.timeout, undefined);
  assert.equal(lossFor(losses, "toolTimeoutSec").severity, "dropped");
});

test("an OAuth client is carried into .mcp.json, which does support it", () => {
  const { config, losses } = toClaudeCode([
    { id: "a", transport: "http", url: "https://e.com/mcp", oauthClientId: "CID", oauthCallbackPort: 9999 },
  ]);
  assert.deepEqual(config.mcpServers.a.oauth, { clientId: "CID", callbackPort: 9999 });
  assert.equal(lossFor(losses, "oauthClientId"), undefined);
});

test("Codex is told it cannot confirm the OAuth client it was given", () => {
  // `codex mcp add --oauth-client-id` writes this shape, but neither
  // `codex mcp get` nor `codex mcp list --json` reports it back.
  const { region, notes } = toCodex([{ id: "a", transport: "http", url: "https://e.com", oauthClientId: "CID" }]);
  assert.match(region, /\[mcp_servers\.a\.oauth\]\nclient_id = "CID"/);
  assert.match(noteFor(notes, "oauthClientId").detail, /cannot be confirmed as applied/);
});

test("a denylist survives onto a remote server as a refusal", () => {
  const { config, notes, losses } = toClaudeCode([
    { id: "a", transport: "http", url: "https://e.com", disabledTools: ["rm_rf"] },
  ]);
  assert.deepEqual(config.mcpServers.a.tools, [{ name: "rm_rf", permission_policy: "always_deny" }]);
  assert.equal(lossFor(losses, "disabledTools"), undefined);
  assert.match(noteFor(notes, "disabledTools").detail, /hides these tools/);
});

test("a denylist on a stdio server is still a lost restriction", () => {
  // Claude Code accepts a tool policy on http and sse and strips it from stdio,
  // so the same field is carried in one place and lost in the other.
  const { config, losses } = toClaudeCode([{ id: "a", transport: "stdio", command: "echo", disabledTools: ["rm_rf"] }]);
  assert.equal(config.mcpServers.a.tools, undefined);
  assert.equal(lossFor(losses, "disabledTools").severity, "weakened");
});

test("an allowlist stays a lost restriction on every transport", () => {
  // Naming what is permitted needs the full set of tools the server offers,
  // which Docket has not asked it for and could not keep current if it had.
  for (const transport of ["stdio", "http", "sse"]) {
    const server = transport === "stdio" ? { command: "echo" } : { url: "https://e.com" };
    const { losses } = toClaudeCode([{ id: "a", transport, ...server, enabledTools: ["read"] }]);
    assert.equal(lossFor(losses, "enabledTools").severity, "weakened", transport);
  }
});

test("the new fields survive a round trip back out of .mcp.json", () => {
  const original = {
    mcpServers: {
      a: {
        type: "http",
        url: "https://e.com/mcp",
        oauth: { clientId: "CID", callbackPort: 9999 },
        timeout: 90_000,
        tools: [{ name: "rm_rf", permission_policy: "always_deny" }],
      },
    },
  };
  const { servers, problems } = fromClaudeCode(original);
  assert.deepEqual(problems, []);
  assert.deepEqual(toClaudeCode(servers).config, original);
});

test("a permission policy that is not a refusal does not become one", () => {
  // always_allow and always_ask have no twin in a Codex denylist, and reading
  // them back as blocked would invent a restriction nobody configured.
  const { servers } = fromClaudeCode({
    mcpServers: { a: { type: "http", url: "https://e.com", tools: [{ name: "x", permission_policy: "always_allow" }] } },
  });
  assert.equal(servers[0].disabledTools, undefined);
});
