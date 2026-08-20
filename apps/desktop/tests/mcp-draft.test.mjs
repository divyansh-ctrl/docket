import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { EMPTY_DRAFT, draftToServer, parseLines, parsePairs, parseList, reach, serverToDraft } =
  jiti("../src/renderer/mcp-draft.ts");

const draft = (over) => ({ ...EMPTY_DRAFT, ...over });

test("a name that could not be written into both files is refused", () => {
  // It has to survive being a TOML key and a JSON key, and be recognisable in
  // a /mcp listing. Easier to fix before it reaches two files than after.
  for (const id of ["", "has space", "-leading", "quote\"mark", "dot.ted"]) {
    const { server, problems } = draftToServer(draft({ id, command: "echo" }));
    assert.equal(server, null, `${JSON.stringify(id)} should be refused`);
    assert.ok(problems.length > 0);
  }
  assert.ok(draftToServer(draft({ id: "good-name_1", command: "echo" })).server);
});

test("a duplicate name is refused rather than silently replacing its twin", () => {
  const { server, problems } = draftToServer(draft({ id: "a", command: "echo" }), ["a"]);
  assert.equal(server, null);
  assert.match(problems[0], /already a server called a/);
});

test("a local server needs a command and a remote one needs a URL", () => {
  assert.match(draftToServer(draft({ id: "a" })).problems[0], /needs a command/);
  assert.match(draftToServer(draft({ id: "a", transport: "http" })).problems[0], /needs a URL/);
  assert.match(
    draftToServer(draft({ id: "a", transport: "http", url: "example.com" })).problems[0],
    /needs a scheme/,
  );
});

test("arguments are one per line, so no quoting rules are invented", () => {
  assert.deepEqual(parseLines("  -y \n\n  some-server  \n"), ["-y", "some-server"]);
});

test("a value may contain the character that split the pair", () => {
  assert.deepEqual(parsePairs("URL=https://e.com/?a=b\nK = v "), { URL: "https://e.com/?a=b", K: "v" });
  // A line with no name is dropped rather than producing an empty key.
  assert.deepEqual(parsePairs("=orphan\nnoequals"), {});
});

test("an unset field is left out rather than written as its default", () => {
  // Absent means on in both CLIs. Writing `enabled = true` would suggest Docket
  // had an opinion it does not have.
  const { server } = draftToServer(draft({ id: "a", command: "echo" }));
  assert.deepEqual(Object.keys(server).sort(), ["command", "id", "transport"]);
  assert.equal("enabled" in server, false);
  assert.equal(draftToServer(draft({ id: "a", command: "echo", enabled: false })).server.enabled, false);
});

test("a draft survives a round trip through a server record", () => {
  const original = draft({
    id: "srv",
    transport: "http",
    url: "https://e.com/mcp",
    headers: "X-A=1\nX-B=2",
    disabledTools: "rm_rf, drop_db",
    enabled: false,
  });
  const { server } = draftToServer(original);
  const back = serverToDraft(server);
  assert.equal(back.url, "https://e.com/mcp");
  assert.equal(back.headers, "X-A=1\nX-B=2");
  assert.equal(back.disabledTools, "rm_rf, drop_db");
  assert.equal(back.enabled, false);
});

test("a transport Codex cannot reach is called out on the row, not after Apply", () => {
  for (const transport of ["sse", "ws"]) {
    const r = reach({ id: "a", transport, url: "https://e.com" });
    assert.equal(r.codex, false, transport);
    assert.equal(r.claude, true, transport);
    assert.match(r.note, /streamable HTTP/);
    // The sentence has to read as English for both, not just for one.
    assert.doesNotMatch(r.note, /\ban [bcdfgjklmnpqrstvwxyz]/i, `awkward article in: ${r.note}`);
    assert.doesNotMatch(r.note, / a [aeiou]/i, `awkward article in: ${r.note}`);
  }
  assert.deepEqual(reach({ id: "a", transport: "stdio", command: "echo" }), {
    claude: true,
    codex: true,
    note: null,
  });
});

test("a switched-off server reads as Codex-only rather than as broken", () => {
  const r = reach({ id: "a", transport: "stdio", command: "echo", enabled: false });
  assert.equal(r.codex, true);
  assert.equal(r.claude, false);
  assert.match(r.note, /Claude Code cannot/);
});

test("a comma list tolerates the spacing people actually type", () => {
  assert.deepEqual(parseList(" a ,b,  c , "), ["a", "b", "c"]);
});
