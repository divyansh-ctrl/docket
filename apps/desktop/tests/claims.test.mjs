import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { extractClaims } = jiti("../src/shared/claims.ts");

// The extractor's one hard rule: a missed claim costs a comparison, an
// invented one puts words in an agent's mouth inside an evidence record. So
// the negative cases here matter more than the positive ones.

test("recognises the ways agents actually report green", () => {
  for (const [text, kind] of [
    ["42 of 42 passing", "test"],
    ["All tests pass", "test"],
    ["tests are green", "test"],
    ["0 tests failing", "test"],
    ["lint is clean", "lint"],
    ["linter passes", "lint"],
    ["typecheck is clean", "typecheck"],
    ["type check passes", "typecheck"],
    ["build succeeds", "build"],
    ["the build is green", "build"],
  ]) {
    const claims = extractClaims(text, "engineer", 1000);
    assert.equal(claims.length, 1, `expected one claim from: ${text}`);
    assert.equal(claims[0].kind, kind, text);
    assert.equal(claims[0].verdict, "passed", text);
    assert.equal(claims[0].agentId, "engineer");
    assert.equal(claims[0].at, 1000);
  }
});

test("an agent reporting its own red is a failure claim, not a pass", () => {
  for (const [text, kind] of [
    ["12 of 15 passing", "test"],
    ["3 tests failing", "test"],
    ["tests are red", "test"],
    ["lint fails", "lint"],
    ["typecheck is failing", "typecheck"],
    ["build fails", "build"],
  ]) {
    const claims = extractClaims(text, "tests", 1);
    assert.equal(claims.length, 1, text);
    assert.equal(claims[0].verdict, "failed", text);
    assert.equal(claims[0].kind, kind, text);
  }
});

test("plans, wishes, and instructions are not claims", () => {
  for (const text of [
    "the tests will pass once the fixture lands",
    "make the tests pass",
    "tests should pass after this",
    "we need to get lint clean",
    "going to run the tests",
    "run the tests before merging",
    "fix the build so that it succeeds",
    "4 files changed in src/auth",
    "Split into three units",
    "Rotate refresh tokens on reuse",
    "",
  ]) {
    assert.deepEqual(extractClaims(text, "lead", 1), [], `misread as a claim: "${text}"`);
  }
});

test("the verbatim sentence travels with the claim", () => {
  const claims = extractClaims(
    "Refactored the session layer. 42 of 42 passing. Docs still to write.",
    "engineer",
    5,
  );
  assert.equal(claims.length, 1);
  // The quote is the sentence that made the claim, not the paragraph.
  assert.equal(claims[0].text, "42 of 42 passing");
});

test("restating a claim is one claim, not growing confidence", () => {
  const claims = extractClaims("tests pass. all tests pass. tests are green.", "review", 1);
  assert.equal(claims.length, 1);
});

test("one summary can claim about several kinds at once", () => {
  const claims = extractClaims("lint is clean and typecheck passes. 8 of 9 passing.", "tests", 1);
  const kinds = claims.map((claim) => claim.kind).sort();
  assert.deepEqual(kinds, ["lint", "test", "typecheck"]);
  assert.equal(claims.find((claim) => claim.kind === "test")?.verdict, "failed");
});
