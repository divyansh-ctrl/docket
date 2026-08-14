// Detection decides who joins the team and who the user pays for, so the cases
// that matter are the quiet ones: a signal that fails to match drops an agent
// with no error anywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { detectAgents } = jiti(fileURLToPath(new URL("../src/shared/detect-agents.ts", import.meta.url)));

const ids = (probe) => detectAgents(probe).map((selection) => selection.id);
const probe = (files = [], dependencies = []) => ({ files, dependencies });

test("an empty repository still gets the core three", () => {
  assert.deepEqual(ids(probe()), ["lead", "engineer", "review"]);
});

test("core agents are marked as always present rather than detected", () => {
  const lead = detectAgents(probe()).find((selection) => selection.id === "lead");
  assert.equal(lead.reason, "Always on the team");
  assert.deepEqual([...lead.evidence], []);
});

test("a test suite brings the test engineer", () => {
  assert.ok(ids(probe(["src/parse.test.ts"])).includes("tests"));
  assert.ok(ids(probe(["tests/unit/thing.py"])).includes("tests"));
  assert.ok(ids(probe(["internal/store_test.go"])).includes("tests"));
  assert.ok(ids(probe([], ["pytest"])).includes("tests"));
});

test("a repository with no tests does not get a test engineer", () => {
  assert.ok(!ids(probe(["src/index.ts", "README.md"])).includes("tests"));
});

test("a user interface brings the interface engineer", () => {
  assert.ok(ids(probe([], ["react"])).includes("interface"));
  assert.ok(ids(probe(["app/Button.svelte"])).includes("interface"));
  assert.ok(!ids(probe(["cmd/main.go"])).includes("interface"));
});

test("a schema brings the data engineer", () => {
  assert.ok(ids(probe(["prisma/schema.prisma"])).includes("data"));
  assert.ok(ids(probe(["db/migrations/001_init.sql"])).includes("data"));
  assert.ok(ids(probe([], ["sqlalchemy"])).includes("data"));
  assert.ok(!ids(probe(["src/index.ts"])).includes("data"));
});

test("a pipeline brings the release engineer", () => {
  assert.ok(ids(probe([".github/workflows/ci.yml"])).includes("release"));
  assert.ok(ids(probe(["Dockerfile"])).includes("release"));
  assert.ok(ids(probe(["infra/main.tf"])).includes("release"));
});

test("credentials and untrusted input bring the security reviewer", () => {
  assert.ok(ids(probe([], ["jsonwebtoken"])).includes("security"));
  assert.ok(ids(probe(["src/auth/session.ts"])).includes("security"));
  assert.ok(ids(probe([".env.example"])).includes("security"));
  assert.ok(!ids(probe(["src/render.ts"])).includes("security"));
});

test("prose about security is not evidence of security surface", () => {
  // A page describing the threat model is documentation. Citing it as the
  // reason a security reviewer joined gives the user a reason they cannot
  // check, which is worse than not selecting the agent at all.
  assert.ok(!ids(probe(["docs/architecture/security.md"])).includes("security"));
  assert.ok(ids(probe(["src/main/security-policy.ts"])).includes("security"));
  // A published policy file is a deliberate signal, and stays one.
  assert.ok(ids(probe(["SECURITY.md"])).includes("security"));
});

test("documentation brings the writer", () => {
  assert.ok(ids(probe(["docs/guide.md"])).includes("docs"));
  assert.ok(ids(probe(["README.md"])).includes("docs"));
});

test("every selection names the signal that produced it", () => {
  const selection = detectAgents(probe(["prisma/schema.prisma"])).find((entry) => entry.id === "data");
  assert.equal(selection.reason, "This repository owns a schema");
  assert.deepEqual([...selection.evidence], ["prisma/schema.prisma"]);
});

test("evidence stays short even when everything matches", () => {
  const files = ["a.test.ts", "b.test.ts", "tests/c.ts", "spec/d.ts", "__tests__/e.ts"];
  const selection = detectAgents(probe(files, ["jest", "vitest", "mocha"])).find((entry) => entry.id === "tests");
  assert.ok(selection.evidence.length <= 3, "evidence should be readable, not exhaustive");
});

test("dependency names match regardless of registry casing", () => {
  assert.ok(ids(probe([], ["React"])).includes("interface"));
  assert.ok(ids(probe([], ["PyJWT"])).includes("security"));
});

test("Windows separators are understood", () => {
  // The probe may be produced on Windows, where paths arrive backslashed.
  assert.ok(ids(probe(["src\\auth\\session.ts"])).includes("security"));
  assert.ok(ids(probe([".github\\workflows\\ci.yml"])).includes("release"));
});

test("the team is always ordered by roster, not by discovery", () => {
  const scrambled = ids(probe([".github/workflows/ci.yml", "docs/x.md", "a.test.ts", "prisma/schema.prisma"]));
  const expected = ["lead", "engineer", "review", "tests", "docs", "interface", "data", "release"];
  assert.deepEqual(
    scrambled,
    expected.filter((id) => scrambled.includes(id)),
  );
});

test("a full-stack repository fields the whole team", () => {
  const full = detectAgents(
    probe(
      ["app/page.tsx", "src/auth/session.ts", "prisma/schema.prisma", "tests/e2e.spec.ts", ".github/workflows/ci.yml", "docs/setup.md"],
      ["react", "prisma", "vitest", "jsonwebtoken"],
    ),
  );
  assert.equal(full.length, 9, "every agent should be justified in this repository");
});
