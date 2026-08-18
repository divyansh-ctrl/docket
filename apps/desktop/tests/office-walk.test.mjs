import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { countWalks, touchesOffice, verdict, CHECKLIST } = jiti("../scripts/office-walk.ts");

// The gate that says "you changed the room and recorded no walk". It exists
// because the two office defects that shipped furthest -- figures whose only
// moving part was their hands, and name tags drawn below the heads they named
// -- were invisible to every assertion in this suite and obvious to a person
// in one second. These tests are about the gate itself firing when it should
// and staying quiet when it should not, since a gate that cries wolf gets
// satisfied with junk rows, which is worse than no gate at all.

const CHECKLIST_BEFORE = `# Checklist
## The rows
| # | What to do | What must be true |
|---|---|---|
| 1 | Look | It looks right |
## Recorded walks
| Date | Themes walked | Result |
|------|---------------|--------|
| 2026-08-01 | dark | pass |
`;

const CHECKLIST_AFTER = `${CHECKLIST_BEFORE}| 2026-08-18 | dark | pass |\n`;

test("only rows under Recorded walks count as walks", () => {
  // The rows-to-walk table sits above and must not be mistaken for evidence
  // of having walked them -- otherwise adding a row to the checklist reads
  // as having done the thing the row describes.
  assert.equal(countWalks(CHECKLIST_BEFORE), 1);
  assert.equal(countWalks(CHECKLIST_AFTER), 2);
  assert.equal(countWalks("# nothing here"), 0);
  assert.equal(countWalks(""), 0);
});

test("the real checklist parses, and every walk in it is counted", () => {
  // Against the committed file, not a fixture: a parser that only works on
  // the example in its own test is not a parser.
  const real = readFileSync(new URL(`../../../${CHECKLIST}`, import.meta.url), "utf8");
  assert.ok(countWalks(real) >= 1, "the committed checklist records no walks");
});

test("the room is what triggers the gate, not the repository", () => {
  assert.equal(touchesOffice(["apps/desktop/src/renderer/office-3d.tsx"]), true);
  assert.equal(touchesOffice(["apps/desktop/src/renderer/office-scene.ts"]), true);
  assert.equal(touchesOffice(["apps/desktop/src/main/container.ts"]), false);
  assert.equal(touchesOffice(["docs/README.md"]), false);
  assert.equal(touchesOffice([]), false);
});

test("the shared stylesheet only counts when the office's own rules changed", () => {
  const sheet = ["apps/desktop/src/renderer/styles.css"];
  // One stylesheet serves the whole app. Treating any edit to it as an office
  // change would fire this gate on work that never opens the office.
  assert.equal(touchesOffice(sheet, "+.providerRow { gap: 4px; }"), false);
  assert.equal(touchesOffice(sheet, "+.floorStage { border-radius: 999px; }"), true);
  assert.equal(touchesOffice(sheet, "-.tagName { font-size: 11px; }"), true);
});

test("changing the room without recording a walk fails, and says which file", () => {
  const problem = verdict(
    ["apps/desktop/src/renderer/office-3d.tsx"],
    CHECKLIST_BEFORE,
    CHECKLIST_BEFORE,
  );
  assert.ok(problem, "the gate stayed quiet on an unrecorded office change");
  // A gate that fails without naming what to do is one people route around.
  assert.match(problem, /office-3d\.tsx/);
  assert.match(problem, /Recorded walks/);
});

test("recording a walk clears it, and untouched work is never asked for one", () => {
  assert.equal(
    verdict(["apps/desktop/src/renderer/office-3d.tsx"], CHECKLIST_BEFORE, CHECKLIST_AFTER),
    null,
  );
  assert.equal(verdict(["apps/desktop/src/main/container.ts"], CHECKLIST_BEFORE, CHECKLIST_BEFORE), null);
});

test("a checklist that did not exist at the base still counts a new walk", () => {
  // The file is read as a git blob, which is absent rather than empty on the
  // commit that introduces it. Zero to one is a walk.
  assert.equal(verdict(["apps/desktop/src/renderer/office-scene.ts"], "", CHECKLIST_AFTER), null);
  assert.ok(verdict(["apps/desktop/src/renderer/office-scene.ts"], "", ""));
});
