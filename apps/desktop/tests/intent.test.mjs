import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { compareIntent, intentTerms, looksSpecific } = jiti("../src/shared/intent.ts");
const { assemblePacket } = jiti("../src/shared/evidence.ts");

// The packet recorded an intent for months and never looked at it. Comparing
// it is easy; comparing it without inventing a verdict is the whole job. These
// hold both lines: the comparison finds what it can, and never claims more.

const FILES = ["apps/desktop/src/main/check-runner.ts", "apps/desktop/tests/runner.test.mjs"];
const SYMBOLS = ["runCheck", "declarationStillStands"];

test("a named file that nothing touched becomes an open question", () => {
  const seen = compareIntent("Rewrite `src/main/token-usage.ts` to dedupe by request id", FILES, SYMBOLS);
  assert.deepEqual(seen.unmatched, ["src/main/token-usage.ts"]);
  assert.equal(seen.vague, false);
});

test("a named file that was touched raises nothing", () => {
  const seen = compareIntent("Fix `check-runner.ts` so a cancel before the spawn still cancels", FILES, SYMBOLS);
  assert.deepEqual(seen.unmatched, []);
  assert.equal(seen.terms.find((term) => term.text === "check-runner.ts").matched, true);
});

test("naming and shipping differ by casing is not a disagreement", () => {
  // Someone who wrote tokenUsage and shipped token-usage.ts has done nothing
  // wrong. A false question about a change that is fine is how a reviewer
  // learns to skip this section, so folding is deliberately generous.
  for (const written of ["tokenUsage", "token_usage", "TokenUsage", "token-usage"]) {
    const seen = compareIntent(`Rework ${written}`, ["src/main/token-usage.ts"], []);
    assert.deepEqual(seen.unmatched, [], `${written} should match token-usage.ts`);
  }
});

test("a symbol is matched as readily as a path", () => {
  const seen = compareIntent("Make `runCheck` honour the abort signal", FILES, SYMBOLS);
  assert.deepEqual(seen.unmatched, []);
});

test("prose raises no questions, however little of it matches", () => {
  // "make the room feel calmer" names nothing a path can be held against.
  // Asking about "feel" and "calmer" would bury the case that matters.
  const seen = compareIntent("Make the room feel calmer and easier to read", FILES, SYMBOLS);
  assert.deepEqual(seen.unmatched, []);
  assert.equal(seen.vague, true, "and the packet says so rather than staying silent");
});

test("a vague intent is reported as vague, not as agreement", () => {
  const packet = base({ intent: "Tidy things up a bit", changedFiles: FILES, changedSymbols: SYMBOLS });
  const finding = packet.findings.find((entry) => entry.id === "intent-vague");
  assert.ok(finding, "silence here would read as a comparison that was satisfied");
  assert.equal(finding.severity, "note");
});

test("an unmatched name is a note and never blocks", () => {
  const packet = base({
    intent: "Rewrite `src/main/token-usage.ts`",
    changedFiles: FILES,
    changedSymbols: SYMBOLS,
  });
  const finding = packet.findings.find((entry) => entry.id.startsWith("intent-unmatched"));
  assert.equal(finding.severity, "note", "a string-matching heuristic is not an observed failure");
  assert.match(finding.detail, /question, not a finding/);
});

test("an unmatched name does not make a passing packet unclean", () => {
  // The strongest thing this may do is ask. If it could flip `clean` it would
  // be a verdict about whether a change does what was asked -- which is the
  // one thing Docket cannot establish.
  const packet = base({
    intent: "Rewrite `src/main/token-usage.ts`",
    changedFiles: FILES,
    changedSymbols: SYMBOLS,
  });
  assert.equal(packet.clean, true);
  assert.ok(packet.findings.some((entry) => entry.id.startsWith("intent-unmatched")));
});

test("backticked and quoted spans are taken whole", () => {
  const terms = intentTerms('Fix `src/main/a-b.ts` and "docs/plan.md" today');
  assert.ok(terms.includes("src/main/a-b.ts"));
  assert.ok(terms.includes("docs/plan.md"));
  assert.ok(!terms.includes("src"), "splitting a named path loses the specificity");
});

test("shape is what makes a term worth asking about", () => {
  for (const specific of ["src/main/a.ts", "a.ts", "checkRunner", "check_runner"]) {
    assert.equal(looksSpecific(specific), true, specific);
  }
  for (const prose of ["calmer", "room", "readable", "everything"]) {
    assert.equal(looksSpecific(prose), false, prose);
  }
  // Found by running this against the repository's own diff: it asked about
  // `intent-versus-diff`, which is a roadmap item and a branch name. English
  // hyphenates as readily as filesystems do, so a bare hyphenated compound
  // never raises a question -- at the cost of not asking about `check-runner`.
  for (const hyphenated of ["intent-versus-diff", "check-runner", "well-tested"]) {
    assert.equal(looksSpecific(hyphenated), false, hyphenated);
  }
});

test("no intent, or no change, means no comparison rather than an empty one", () => {
  assert.equal(compareIntent("", FILES, SYMBOLS).skipped, true);
  assert.equal(compareIntent("Fix `a.ts`", [], []).skipped, true);
  const packet = base({ intent: "", changedFiles: [], changedSymbols: [] });
  assert.equal(packet.intentCheck.skipped, true);
  assert.equal(
    packet.findings.some((entry) => entry.id.startsWith("intent-")),
    false,
    "there is already a finding for a missing intent; a second would be noise",
  );
});

test("the comparison is carried in the packet, terms and all", () => {
  const packet = base({
    intent: "Rewrite `src/main/token-usage.ts` and `check-runner.ts`",
    changedFiles: FILES,
    changedSymbols: SYMBOLS,
  });
  // Quoted spans are pulled out first, so they lead; the loose words follow.
  // Non-specific terms are carried too, unreported: the packet showing what it
  // looked at is the difference between "checked and found nothing" and
  // "did not look".
  const carried = packet.intentCheck.terms.map((term) => [term.text, term.specific, term.matched]);
  assert.deepEqual(carried, [
    ["src/main/token-usage.ts", true, false],
    ["check-runner.ts", true, true],
    ["Rewrite", false, false],
  ]);
});

/** A packet that is otherwise clean, so intent findings are read in isolation. */
function base(over) {
  return assemblePacket({
    intent: "",
    changedFiles: [],
    changedSymbols: [],
    change: { files: 2, added: 10, removed: 2, truncated: false, unavailable: null },
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
