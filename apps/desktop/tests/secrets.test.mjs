import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { scanSecrets, mask, isPlaceholder, looksLikeFixture } = jiti("../src/shared/secrets.ts");
const { assemblePacket } = jiti("../src/shared/evidence.ts");

// A scanner that quotes what it found has published the secret further than
// the commit did. That is the first thing these hold. The second is that every
// statement is about the line, never about the world: Docket has not checked
// whether a key is live, a fixture, or revoked an hour ago.

const at = (text, path = "src/a.ts", line = 3) => [{ path, line, text }];

test("the value never reaches the finding", () => {
  const secret = "AKIAIOSFODNN7EXAMPLE";
  const { matches } = scanSecrets(at(`const key = "${secret}"`));
  assert.equal(matches.length, 1);
  assert.ok(!JSON.stringify(matches).includes(secret), "the packet must not carry the value");
  assert.match(matches[0].preview, /^AKIA\*+ \(20 characters\)$/);
});

test("the value never reaches the packet either", () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const packet = base({
    secrets: scanSecrets(at(`token = "${secret}"`)),
  });
  assert.ok(!JSON.stringify(packet).includes(secret));
  assert.ok(JSON.stringify(packet).includes("src/a.ts:3"), "but the position is there to act on");
});

test("issuer-named shapes are found", () => {
  const cases = [
    ["-----BEGIN RSA PRIVATE KEY-----", "private-key"],
    ["-----BEGIN PRIVATE KEY-----", "private-key"],
    ["AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github-token"],
    ["xoxb-123456789012-abcdefghijkl", "slack-token"],
    ["sk_live_abcdefghij0123456789", "stripe-key"],
    ["AIzaSyA1234567890abcdefghijklmnopqrstuv", "google-api-key"],
    ["sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345", "anthropic-key"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N", "json-web-token"],
  ];
  for (const [text, ruleId] of cases) {
    const { matches } = scanSecrets(at(text));
    assert.equal(matches[0]?.ruleId, ruleId, text.slice(0, 24));
    assert.equal(matches[0].confidence, "named");
  }
});

test("code that handles secrets correctly is not a finding", () => {
  // These are the *right* shapes. Flagging them teaches a reviewer to scroll
  // past the section, which costs more than the rare miss.
  const clean = [
    'const apiKey = process.env.API_KEY',
    'password: "changeme"',
    'token = "your-api-key-here"',
    'secret: "${VAULT_SECRET}"',
    'password = "xxxxxxxxxxxx"',
    'const credential = "<your-token>"',
    'apiKey: "example-key-not-real"',
  ];
  for (const line of clean) {
    assert.deepEqual(scanSecrets(at(line)).matches, [], line);
  }
});

test("camelCase secret names are caught, since that is how they are written", () => {
  // A leading word boundary missed `dbPassword`, `userApiKey` and every other
  // name real code uses, which left the generic rule matching almost nothing.
  for (const line of [
    'const dbPassword = "h8Fj2kLm9QzXw4Rt"',
    'userApiKey: "h8Fj2kLm9QzXw4Rt"',
    'const serviceToken = "h8Fj2kLm9QzXw4Rt"',
  ]) {
    assert.equal(scanSecrets(at(line)).matches.length, 1, line);
  }
});

test("a long value on a secret-sounding name is reported apart, and softer", () => {
  const { matches } = scanSecrets(at('const dbPassword = "h8Fj2kLm9QzXw4Rt"'));
  assert.equal(matches[0].confidence, "generic");
  const packet = base({ secrets: scanSecrets(at('const dbPassword = "h8Fj2kLm9QzXw4Rt"')) });
  const finding = packet.findings.find((entry) => entry.id.startsWith("secret-assignments"));
  assert.equal(finding.severity, "attention", "weaker evidence, reported at a weaker level");
  assert.equal(
    packet.findings.some((entry) => entry.id.startsWith("secret-shapes")),
    false,
  );
});

test("an issuer-named shape blocks, and says what it did not check", () => {
  const packet = base({ secrets: scanSecrets(at("AKIAIOSFODNN7EXAMPLE")) });
  const finding = packet.findings.find((entry) => entry.id.startsWith("secret-shapes"));
  assert.equal(finding.severity, "blocking");
  assert.equal(packet.clean, false, "an observed shape is not a heuristic about intent");
  assert.match(finding.detail, /live, a fixture, or already revoked is not something Docket checked/);
  assert.ok(!/leaked|compromised/i.test(finding.title), "a shape is not a claim about the world");
});

test("the more specific rule wins, and a line is one finding", () => {
  const { matches } = scanSecrets(at('const apiKey = "AKIAIOSFODNN7EXAMPLE"'));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].ruleId, "aws-access-key", "not the generic assignment rule");
});

test("a minified bundle is skipped and the skip is counted", () => {
  const scan = scanSecrets(at(`const a=1;${"x".repeat(3000)}`));
  assert.deepEqual(scan.matches, []);
  assert.equal(scan.skippedLongLines, 1);
});

test("a capped scan says the silence means nothing", () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    path: `src/f${index}.ts`,
    line: 1,
    text: "-----BEGIN RSA PRIVATE KEY-----",
  }));
  const scan = scanSecrets(many);
  assert.equal(scan.truncated, true);
  const packet = base({ secrets: scan });
  const finding = packet.findings.find((entry) => entry.id === "secret-scan-truncated");
  assert.match(finding.detail, /absence of further findings here means nothing/);
});

test("a new file that would not open is reported, not passed over", () => {
  const packet = base({ secrets: scanSecrets([]), secretsUnread: 2 });
  const finding = packet.findings.find((entry) => entry.id === "secret-scan-unread");
  assert.match(finding.detail, /says nothing about what was not/);
});

test("masking cannot reconstruct the value", () => {
  assert.equal(mask("abcdefghijklmnop"), "abcd******** (16 characters)");
  assert.equal(mask("ab"), "** (2 characters)");
  assert.ok(!mask("supersecretvalue").includes("secret"));
});

test("placeholder detection covers the shapes real code uses", () => {
  for (const value of ["process.env.TOKEN", "${TOKEN}", "<token>", "changeme", "aaaaaaaa", "xxxxxxxx"]) {
    assert.equal(isPlaceholder(value), true, value);
  }
  assert.equal(isPlaceholder("h8Fj2kLm9QzXw4Rt"), false);
});

test("an all-capitals credential is not mistaken for an environment variable", () => {
  // The regression that made this split necessary. `^[A-Z0-9_]+$` was meant to
  // catch a bare `API_KEY`, and it silently swallowed every AWS access key id,
  // which is also nothing but capitals and digits. The scanner reported a clean
  // line it had never really looked at.
  assert.equal(isPlaceholder("AKIAIOSFODNN7EXAMPLE", "named"), false);
  assert.equal(isPlaceholder("API_KEY", "generic"), true);
  assert.equal(scanSecrets(at("AKIAIOSFODNN7EXAMPLE")).matches.length, 1);
});

/** A packet that is otherwise clean, so secret findings are read in isolation. */
function base(over) {
  return assemblePacket({
    intent: "Rotate the deploy credentials in `src/a.ts`",
    changedFiles: ["src/a.ts"],
    changedSymbols: [],
    change: { files: 1, added: 4, removed: 0, truncated: false, unavailable: null },
    committedUnavailable: false,
    claims: [],
    reach: { references: [], contained: [], unavailable: null },
    checks: [
      {
        check: {
          id: "npm:test",
          kind: "test",
          label: "npm run test",
          runner: "npm",
          script: "test",
          source: "package.json",
          confidence: "declared",
          command: null,
        },
        result: {
          checkId: "npm:test",
          outcome: "passed",
          exitCode: 0,
          output: "",
          argv: ["npm", "run", "test"],
          isolation: "container",
          isolationReason: null,
          startedAt: 0,
          finishedAt: 1,
        },
        drift: null,
      },
    ],
    ...over,
  });
}


test("a fixture path lowers the level and never the report", () => {
  // The scanner's first real run against this repository produced twenty-two
  // findings, every one a fixture in its own test file. A gate that blocks its
  // own repository forever is one people learn to override.
  const scan = scanSecrets([
    { path: "apps/desktop/tests/secrets.test.mjs", line: 9, text: "AKIAIOSFODNN7EXAMPLE" },
  ]);
  assert.equal(scan.matches[0].fixture, true);

  const packet = base({ secrets: scan });
  const finding = packet.findings.find((entry) => entry.id.startsWith("secret-fixture"));
  assert.equal(finding.severity, "attention");
  assert.match(finding.detail, /tests\/secrets\.test\.mjs:9/, "still named, still positioned");
  assert.equal(packet.clean, true, "a fixture does not block");
  assert.equal(
    packet.findings.some((entry) => entry.id.startsWith("secret-shapes:")),
    false,
  );
});

test("the same shape outside a fixture path still blocks", () => {
  const scan = scanSecrets([{ path: "src/main/deploy.ts", line: 9, text: "AKIAIOSFODNN7EXAMPLE" }]);
  assert.equal(scan.matches[0].fixture, false);
  const packet = base({ secrets: scan });
  assert.equal(packet.clean, false);
});

test("the fixture rule says where it applies", () => {
  for (const path of [
    "tests/a.ts",
    "src/__tests__/a.ts",
    "spec/a.rb",
    "fixtures/keys.json",
    "docs/setup.md",
    "examples/config.yml",
    "src/main/thing.test.ts",
    "testdata/sample.json",
  ]) {
    assert.equal(looksLikeFixture(path), true, path);
  }
  for (const path of ["src/main/deploy.ts", "lib/contest.ts", "app/latest/index.ts"]) {
    assert.equal(looksLikeFixture(path), false, path);
  }
});
