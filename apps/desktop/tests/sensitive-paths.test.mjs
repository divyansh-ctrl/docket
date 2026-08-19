import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { classifyPaths, declaresInstallHook, CATEGORIES } = jiti("../src/shared/sensitive-paths.ts");
const { assemblePacket } = jiti("../src/shared/evidence.ts");

// These answer a question prior to "is this change correct": is the rest of
// this packet worth what it appears to be worth. A suite that passes proves
// less if the same change edited the workflow that runs it.

const ids = (paths, hooks = []) => classifyPaths(paths, hooks).map((entry) => entry.categoryId);

test("the machinery that runs the checks is recognised", () => {
  assert.deepEqual(ids([".github/workflows/ci.yml"]), ["ci-config"]);
  assert.deepEqual(ids([".gitlab-ci.yml"]), ["ci-config"]);
  assert.deepEqual(ids(["Jenkinsfile"]), ["ci-config"]);
  assert.deepEqual(ids([".husky/pre-commit"]), ["git-hooks"]);
  assert.deepEqual(ids([".pre-commit-config.yaml"]), ["git-hooks"]);
  assert.deepEqual(ids(["docket.json"]), ["docket-config"]);
  assert.deepEqual(ids(["Dockerfile"]), ["container-definition"]);
  assert.deepEqual(ids(["docker-compose.yml"]), ["container-definition"]);
  assert.deepEqual(ids([".gitignore"]), ["ignore-rules"]);
  assert.deepEqual(ids(["package-lock.json"]), ["dependency-lock"]);
  assert.deepEqual(ids(["go.sum"]), ["dependency-lock"]);
});

test("configuration that decides which hooks fire is recognised", () => {
  // Claims reach the packet through the CLI's own hook events. Config that
  // turns those off decides what this packet could ever have caught.
  assert.deepEqual(ids([".claude/settings.json"]), ["agent-config"]);
  assert.deepEqual(ids([".codex/config.json"]), ["agent-config"]);
  assert.deepEqual(ids([".claude/hooks/pre-tool.sh"]), ["agent-config"]);
});

test("nested paths are matched, not just repository roots", () => {
  assert.deepEqual(ids(["apps/web/Dockerfile"]), ["container-definition"]);
  assert.deepEqual(ids(["packages/core/.gitignore"]), ["ignore-rules"]);
  assert.deepEqual(ids(["services/api/docket.json"]), ["docket-config"]);
});

test("ordinary source is not sensitive", () => {
  assert.deepEqual(
    ids([
      "src/main/runner.ts",
      "README.md",
      "apps/desktop/src/shared/evidence.ts",
      "docs/plan.md",
      "workflows/thing.ts",
      "my-dockerfile-notes.md",
    ]),
    [],
  );
});

test("a package.json is reported only when it gains an install script", () => {
  // Every manifest edit would otherwise be reported and almost none of them
  // adds a postinstall, which is the thing worth looking at.
  assert.deepEqual(ids(["package.json"]), [], "an ordinary manifest edit is not this");
  assert.deepEqual(ids(["package.json"], ["package.json"]), ["install-hook"]);
});

test("the lifecycle keys that run code without being asked", () => {
  for (const key of ["preinstall", "install", "postinstall", "prepare", "prepublishOnly", "prepack"]) {
    assert.equal(declaresInstallHook(`  "${key}": "node evil.js",`), true, key);
  }
  for (const key of ["test", "build", "lint", "start", "installDeps"]) {
    assert.equal(declaresInstallHook(`  "${key}": "vitest run",`), false, key);
  }
});

test("a lockfile is a note; the rest ask for attention", () => {
  const packet = base({ governing: classifyPaths(["package-lock.json", ".github/workflows/ci.yml"]) });
  const lock = packet.findings.find((entry) => entry.id === "governing:dependency-lock");
  const ci = packet.findings.find((entry) => entry.id === "governing:ci-config");
  assert.equal(lock.severity, "note", "lockfiles move constantly");
  assert.equal(ci.severity, "attention");
});

test("none of it blocks, and none of it makes a packet unclean", () => {
  // A gate that stopped every branch touching a workflow would be overridden
  // within a week and would then be stopping nothing. The wanted action is
  // that a reviewer reads the diff.
  const packet = base({
    governing: classifyPaths([".github/workflows/ci.yml", "docket.json", ".gitignore", "Dockerfile"]),
  });
  assert.equal(packet.clean, true);
  assert.equal(
    packet.findings.some((entry) => entry.id.startsWith("governing:") && entry.severity === "blocking"),
    false,
  );
});

test("the finding says what it means for the other evidence", () => {
  const packet = base({ governing: classifyPaths([".github/workflows/ci.yml"]) });
  const finding = packet.findings.find((entry) => entry.id === "governing:ci-config");
  assert.match(finding.detail, /green result describes the new rules/);
  assert.ok(!/suspicious|malicious|hiding/i.test(finding.detail), "a fact, not an accusation");
});

test("every category justifies itself in one sentence", () => {
  // The section's value is that everything in it repays a look. A category
  // nobody can explain does not belong.
  for (const category of CATEGORIES) {
    assert.ok(category.consequence.length > 40, category.id);
    assert.ok(category.label.length > 0, category.id);
  }
});

/** A packet that is otherwise clean, so these findings are read in isolation. */
function base(over) {
  return assemblePacket({
    intent: "Update the release workflow",
    changedFiles: [".github/workflows/ci.yml"],
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
