import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { statusOf, tallyZones, describeFloor } = jiti("../src/renderer/office-shell.ts");

// The shell's whole job is to describe a floor without adding to it. These
// hold the two ways that goes wrong: a status that outranks the wrong thing,
// and a summary that reads better than the facts behind it.

const at = (zone, extra = {}) => ({
  id: "engineer",
  presence: {
    id: "engineer",
    zone,
    intent: "",
    says: null,
    toward: null,
    blocked: false,
    waitingOnYou: false,
    ...extra,
  },
});

test("status ranks by what a reviewer must not miss", () => {
  // Every one of these is simultaneously true of the same agent. The order
  // matters: your move outranks its problem, and its problem outranks its
  // progress, because only the first is a thing you can act on right now.
  const everything = at("desk", { waitingOnYou: true, blocked: true, intent: "refactoring" });
  assert.equal(statusOf(everything.presence).tone, "waiting");

  const stuck = at("desk", { blocked: true, intent: "refactoring" });
  assert.equal(statusOf(stuck.presence).tone, "blocked");

  const busy = at("desk", { intent: "refactoring" });
  assert.equal(statusOf(busy.presence).tone, "working");
});

test("an agent with nothing recorded is idle, not working", () => {
  // The temptation is to call a silent agent busy, because a floor of idle
  // people looks broken. Silence in the record is silence in the room.
  assert.equal(statusOf(at("desk").presence).tone, "idle");
  assert.equal(statusOf(at("desk").presence).label, "idle");
});

test("the tally keeps its empty zones", () => {
  const tally = tallyZones([at("review"), at("review"), at("desk")]);

  // Every stage, always. An empty test lab beside a crowded review bench is
  // the fact the floor exists to show, and dropping zeroes hides it.
  const { ZONES } = jiti("../src/renderer/office-scene.ts");
  assert.equal(tally.length, ZONES.length);
  assert.deepEqual(
    tally.map((zone) => zone.id),
    ZONES.map((zone) => zone.id),
    "the tally must stay in pipeline order",
  );

  const byId = new Map(tally.map((zone) => [zone.id, zone]));
  assert.equal(byId.get("review").count, 2);
  assert.equal(byId.get("desk").count, 1);
  assert.equal(byId.get("lab").count, 0);
});

test("a zone flags itself when someone in it is waiting on you", () => {
  const tally = tallyZones([at("waiting", { waitingOnYou: true }), at("desk")]);
  const byId = new Map(tally.map((zone) => [zone.id, zone]));
  assert.equal(byId.get("waiting").needsYou, true);
  assert.equal(byId.get("desk").needsYou, false);
});

test("the floor describes itself in facts, and counts nobody twice", () => {
  assert.equal(describeFloor([]), "No agents on this floor yet");
  assert.equal(describeFloor([at("desk")]), "1 agent");

  // An agent that is both waiting on you and blocked is counted once, under
  // the heading that is your move -- otherwise a floor of three reads as five.
  const mixed = [
    at("desk"),
    at("waiting", { waitingOnYou: true, blocked: true }),
    at("desk", { blocked: true }),
  ];
  assert.equal(describeFloor(mixed), "3 agents · 1 waiting on you · 1 blocked");

  // And a quiet floor says only its size. No adjectives.
  assert.equal(describeFloor([at("desk"), at("desk")]), "2 agents");
});
