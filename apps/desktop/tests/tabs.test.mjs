import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { nextTab, TABS, TAB_IDS } = jiti("../src/renderer/tabs.ts");

// The app had four independent booleans deciding what was on screen and
// nothing stopped two being true at once. These hold the replacement to the
// rules that make one active surface an invariant rather than a habit.

const always = () => true;
const needsWorkspace = (tab) => !tab.requiresWorkspace;

test("arrowing right walks the strip and wraps", () => {
  const order = TABS.map((tab) => tab.id);
  let at = order[0];
  const walked = [at];
  for (let step = 0; step < order.length; step += 1) {
    at = nextTab(at, 1, always);
    walked.push(at);
  }
  assert.deepEqual(walked.slice(0, order.length), order);
  assert.equal(walked[order.length], order[0], "and comes back round");
});

test("arrowing left wraps the other way", () => {
  const first = TABS[0].id;
  const last = TABS[TABS.length - 1].id;
  assert.equal(nextTab(first, -1, always), last);
});

test("a tab that cannot be opened is stepped over, not landed on", () => {
  // Arrowing onto something disabled and having nothing happen is how a
  // keyboard user loses their place.
  const reachable = TABS.filter(needsWorkspace).map((tab) => tab.id);
  let at = reachable[0];
  for (let step = 0; step < TABS.length + 2; step += 1) {
    at = nextTab(at, 1, needsWorkspace);
    assert.ok(reachable.includes(at), `${at} requires a workspace and was landed on`);
  }
});

test("a current tab that stops being openable lands somewhere that is", () => {
  // Closing a repository while the office is showing: the office needs a
  // workspace, so the strip has to resolve rather than stay pointed at it.
  const office = TABS.find((tab) => tab.requiresWorkspace);
  assert.ok(office, "this test is meaningless if no tab requires a workspace");
  const landed = nextTab(office.id, 1, needsWorkspace);
  assert.equal(TABS.find((tab) => tab.id === landed)?.requiresWorkspace, false);
});

test("with nothing openable the current tab is kept rather than invented", () => {
  assert.equal(nextTab("floor", 1, () => false), "floor");
});

test("every tab in the strip is a real surface", () => {
  // A tab strip reads as a description of what the app does. Laying out the
  // planned set with the unbuilt ones disabled is the same mistake as a packet
  // with an empty section.
  assert.deepEqual(
    TABS.map((tab) => tab.id),
    [...TAB_IDS],
  );
  for (const tab of TABS) {
    assert.ok(tab.label.length > 0, `${tab.id} needs a label`);
  }
});
