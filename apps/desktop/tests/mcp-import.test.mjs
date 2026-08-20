import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { parseCodexToolFilters } = jiti("../src/shared/mcp-config.ts");
const { importFromCodex } = jiti("../src/main/mcp-files.ts");
const { assertAllowlistedRead } = jiti("../src/main/security-policy.ts");

// Real output, copied from `codex mcp get` against codex-cli 0.147.0.
const GET_WITH_FILTERS = `multi
  enabled: true
  enabled_tools: read_file, write_file, list dir
  disabled_tools: rm_rf
  transport: stdio
  command: echo
  remove: codex mcp remove multi
`;
const GET_WITHOUT = `none
  enabled: true
  transport: stdio
  command: echo
  remove: codex mcp remove none
`;

test("the tool filters are recovered from the text that reports them", () => {
  const filters = parseCodexToolFilters(GET_WITH_FILTERS);
  assert.deepEqual(filters.enabledTools, ["read_file", "write_file", "list dir"]);
  assert.deepEqual(filters.disabledTools, ["rm_rf"]);
  assert.deepEqual(filters.unreadable, []);
});

test("an absent line means absent, not empty", () => {
  // "nothing is blocked" and "the blocked tools could not be read" must not
  // look the same to the caller.
  const filters = parseCodexToolFilters(GET_WITHOUT);
  assert.equal(filters.enabledTools, undefined);
  assert.equal(filters.disabledTools, undefined);
  assert.deepEqual(filters.unreadable, []);
});

test("a line that yields nothing is reported rather than read as empty", () => {
  const filters = parseCodexToolFilters("srv\n  disabled_tools: -\n  transport: stdio\n");
  assert.equal(filters.disabledTools, undefined);
  assert.deepEqual(filters.unreadable, ["disabledTools"]);
});

test("a tool named like the heading cannot be mistaken for it", () => {
  const filters = parseCodexToolFilters("srv\n  enabled_tools: safe, disabled_tools: sneaky\n");
  assert.deepEqual(filters.enabledTools, ["safe", "disabled_tools: sneaky"]);
  assert.equal(filters.disabledTools, undefined);
});

// --- the two-pass import ------------------------------------------------

const LISTING = JSON.stringify([
  { name: "alpha", enabled: true, transport: { type: "stdio", command: "echo" } },
  { name: "beta", enabled: true, transport: { type: "streamable_http", url: "https://e.com/mcp" } },
]);

const reader = (responses) => async (args) => {
  const key = args.join(" ");
  return responses[key] ?? { ok: false, stdout: "", reason: `no stub for ${key}` };
};

test("a tool denylist invisible to the JSON listing is recovered by the second pass", () => {
  // This is the whole point: importing from `list --json` alone would drop the
  // restriction on the next write and tell nobody.
  return importFromCodex(
    reader({
      "mcp list --json": { ok: true, stdout: LISTING, reason: null },
      "mcp get alpha": { ok: true, stdout: GET_WITH_FILTERS, reason: null },
      "mcp get beta": { ok: true, stdout: GET_WITHOUT, reason: null },
    }),
  ).then((result) => {
    const alpha = result.servers.find((server) => server.id === "alpha");
    assert.deepEqual(alpha.disabledTools, ["rm_rf"]);
    assert.deepEqual(alpha.enabledTools, ["read_file", "write_file", "list dir"]);
    assert.equal(result.servers.find((server) => server.id === "beta").disabledTools, undefined);
    assert.deepEqual(result.problems, []);
  });
});

test("a server whose second pass fails arrives with the loss stated", () => {
  return importFromCodex(
    reader({
      "mcp list --json": { ok: true, stdout: LISTING, reason: null },
      "mcp get beta": { ok: true, stdout: GET_WITHOUT, reason: null },
    }),
  ).then((result) => {
    assert.equal(result.servers.length, 2, "the server is still imported");
    const problem = result.problems.find((entry) => entry.server === "alpha");
    assert.match(problem.detail, /could not be read/);
  });
});

test("Codex being absent is reported, not treated as no servers", () => {
  return importFromCodex(async () => ({ ok: false, stdout: "", reason: "codex was not found on this machine." })).then(
    (result) => {
      assert.deepEqual(result.servers, []);
      assert.match(result.problems[0].detail, /not found/);
    },
  );
});

test("output that is not JSON is refused rather than half-read", () => {
  return importFromCodex(reader({ "mcp list --json": { ok: true, stdout: "not json", reason: null } })).then((result) => {
    assert.deepEqual(result.servers, []);
    assert.match(result.problems[0].detail, /not readable as JSON/);
  });
});

// --- the read allowlist -------------------------------------------------

test("only the two read commands are permitted, and get takes one safe name", () => {
  assert.doesNotThrow(() => assertAllowlistedRead("codex", ["mcp", "list", "--json"]));
  assert.doesNotThrow(() => assertAllowlistedRead("codex", ["mcp", "get", "my-server"]));

  for (const args of [
    ["mcp", "remove", "my-server"],
    ["mcp", "add", "x", "--url", "https://e.com"],
    ["mcp", "get"],
    ["mcp", "get", "a", "b"],
    ["mcp", "get", "--help"],
    ["mcp", "get", "; rm -rf /"],
    ["mcp", "get", "../escape"],
    ["mcp", "list"],
  ]) {
    assert.throws(() => assertAllowlistedRead("codex", args), /non-allowlisted/, args.join(" "));
  }
  assert.throws(() => assertAllowlistedRead("claude", ["mcp", "list", "--json"]), /non-allowlisted/);
});
