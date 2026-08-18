import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  BENCH,
  DESKS,
  DESK_UNIT,
  SEATS_BY_ZONE,
  ZONES,
  chairOf,
  seatCount,
  seatFor,
  turnTowards,
  zoneRect,
} = jiti("../src/renderer/office-scene.ts");

// The office is the one subsystem where nothing could fail a test, and the
// bill for that arrived all at once: seats detached from rotated desks,
// screens facing away from their sitters, standees inside furniture. These
// invariants are the geometry contracts those defects broke. They are pure
// maths over the scene module -- no WebGL, no DOM, no three.js.

/** Shortest circular distance between two headings. */
function headingGap(a, b) {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

test("every desk seat is on its desk's chair, whatever the desk's heading", () => {
  // The defect this pins: seats were derived as `desk.z + 0.95`, a world-axis
  // offset that is only the chair's position when the desk faces exactly PI.
  // The desks were angled into pods; the seats stayed on the old axis; the
  // figures sat on air at grid angles, through the rotated furniture.
  for (const [index, desk] of DESKS.entries()) {
    const seat = seatFor("desk", index, DESKS.length);
    const chair = chairOf(desk);

    const apart = Math.hypot(seat.x - chair.x, seat.z - chair.z);
    assert.ok(
      apart < 0.01,
      `desk ${index} (heading ${desk.heading.toFixed(2)}): seat is ${apart.toFixed(2)} from its chair`,
    );
    assert.ok(
      headingGap(seat.heading, chair.heading) < 0.01,
      `desk ${index}: the sitter faces ${seat.heading.toFixed(2)}, the chair faces ${chair.heading.toFixed(2)}`,
    );
    assert.equal(seat.seated, true);
  }
});

test("the chair, the keyboard, and the screen's face are on the same side of the desk", () => {
  // The person sits at chairZ. The keyboard must be reachable from there, and
  // the glass must face them: glass in front of the monitor body faces +z,
  // glass behind it faces -z. For years of this scene's life the chair was at
  // -0.95 while the keyboard sat at +0.1 and the glass faced +z -- every
  // sitter looking at the back of their own monitor.
  const chairSide = Math.sign(DESK_UNIT.chairZ);

  assert.equal(
    Math.sign(DESK_UNIT.keyboardZ),
    chairSide,
    `keyboard at z=${DESK_UNIT.keyboardZ} is across the desk from the chair at z=${DESK_UNIT.chairZ}`,
  );

  const glassFacing = Math.sign(DESK_UNIT.glassZ - DESK_UNIT.monitorZ);
  assert.equal(
    glassFacing,
    chairSide,
    `the screen faces ${glassFacing > 0 ? "+z" : "-z"} but the chair is on the ${chairSide > 0 ? "+z" : "-z"} side`,
  );
});

test("every zone's built seats lie inside their zone", () => {
  for (const zone of ZONES) {
    for (let index = 0; index < seatCount(zone.id); index += 1) {
      const seat = seatFor(zone.id, index, seatCount(zone.id));
      const rect = zoneRect(zone.id);
      // Half a metre of tolerance: a chair may stand at a zone's edge, but a
      // seat in a different zone entirely is an agent shown in the wrong state.
      assert.ok(
        seat.x > rect.x0 - 0.5 && seat.x < rect.x1 + 0.5 && seat.z > rect.z0 - 0.5 && seat.z < rect.z1 + 0.5,
        `${zone.id} seat ${index} at (${seat.x}, ${seat.z}) is outside ${JSON.stringify(rect)}`,
      );
    }
  }
});

test("review bench sitters are actually at the bench", () => {
  // The bench passed the screen-facing audit -- its monitors face its seats.
  // This keeps that true if the bench ever moves: seated review seats must be
  // within the bench's span and within a stride of its edge.
  const seated = SEATS_BY_ZONE.review.filter((seat) => seat.seated);
  assert.ok(seated.length > 0, "the review bench declares seated seats");
  for (const seat of seated) {
    assert.ok(Math.abs(seat.x - BENCH.x) <= BENCH.width / 2, `seat x=${seat.x} is off the bench`);
    assert.ok(Math.abs(seat.z - BENCH.z) <= 1.6, `seat z=${seat.z} is a walk away from the bench`);
  }
});

test("overflow standees never stand inside a desk", () => {
  // Past the built seats, agents stand. The fallback used to spread them
  // across the whole zone rectangle -- which contains the desks.
  for (let total = DESKS.length + 1; total <= 9; total += 1) {
    for (let index = DESKS.length; index < total; index += 1) {
      const spot = seatFor("desk", index, total);
      for (const desk of DESKS) {
        const apart = Math.hypot(spot.x - desk.x, spot.z - desk.z);
        assert.ok(
          apart > 1.0,
          `standee ${index} of ${total} at (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}) is inside desk at (${desk.x}, ${desk.z})`,
        );
      }
      assert.equal(spot.seated, false, "an overflow spot must not claim a chair that is not there");
    }
  }
});

test("every seat in every zone is finite and sane", () => {
  for (const zone of ZONES) {
    for (let total = 1; total <= 9; total += 1) {
      for (let index = 0; index < total; index += 1) {
        const seat = seatFor(zone.id, index, total);
        assert.ok(Number.isFinite(seat.x) && Number.isFinite(seat.z), `${zone.id} ${index}/${total}`);
        assert.ok(Number.isFinite(seat.heading));
        assert.ok(Math.abs(seat.heading) <= Math.PI * 2 + 0.01, `heading ${seat.heading} is unnormalized`);
      }
    }
  }
});

test("turning is always the short way round", () => {
  // A figure that spins the long way reads as broken even when it ends up
  // facing the right direction.
  assert.ok(Math.abs(turnTowards(0.1, Math.PI * 2 - 0.1, 10) - -0.1) < 1e-9);
  assert.ok(Math.abs(turnTowards(-3, 3, 10) - (-3 - (Math.PI * 2 - 6))) < 1e-9);
  // And it never overshoots the cap.
  const step = turnTowards(0, Math.PI, 0.2);
  assert.ok(Math.abs(step) <= 0.2 + 1e-9);
});

test("no pose ever bends a joint past its physical stop", async () => {
  const { sitPose, standPose, walkPose } = jiti("../src/renderer/office-scene.ts");

  // Sampled across time and gait phase. A knee below zero bends forwards,
  // which legs do not do; a thigh past vertical folds into the torso.
  for (let step = 0; step < 60; step += 1) {
    const time = step * 0.37;
    const phase = step * 0.53;
    for (const pose of [
      sitPose(time, phase, step % 2 === 0),
      standPose(time, phase, step % 3 === 0),
      walkPose(phase),
    ]) {
      for (const knee of [pose.kneeLeft, pose.kneeRight]) {
        assert.ok(knee >= 0, `a knee bent forwards: ${knee}`);
        assert.ok(knee <= Math.PI / 2 + 0.01, `a knee folded past square: ${knee}`);
      }
      for (const thigh of [pose.thighLeft, pose.thighRight]) {
        assert.ok(thigh >= -Math.PI / 2 - 0.01 && thigh <= 0.9, `a thigh out of range: ${thigh}`);
      }
      for (const elbow of [pose.elbowLeft, pose.elbowRight]) {
        assert.ok(elbow <= 0.01, `an elbow bent backwards: ${elbow}`);
        assert.ok(elbow >= -1.6, `an elbow folded into the arm: ${elbow}`);
      }
      assert.ok(Number.isFinite(pose.bodyY) && Math.abs(pose.bodyY) < 1);
    }
  }
});

test("sitting puts the hip on the chair pan, not a remembered constant", async () => {
  const { sitPose, RIG } = jiti("../src/renderer/office-scene.ts");

  const pose = sitPose(0, 0, false);
  // The rig's hip rides at RIG.hip; the drop must land it exactly on the pan.
  assert.ok(
    Math.abs(RIG.hip + pose.bodyY - RIG.panTop) < 1e-9,
    `hip lands at ${RIG.hip + pose.bodyY}, pan top is ${RIG.panTop}`,
  );
  // And seated shins hang square from level thighs: feet under knees.
  assert.ok(Math.abs(pose.thighLeft + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(pose.kneeLeft - Math.PI / 2) < 1e-9);
});

test("the walking gait bends each knee only on its backswing", async () => {
  const { walkPose } = jiti("../src/renderer/office-scene.ts");

  for (let step = 0; step < 32; step += 1) {
    const phase = (step / 32) * Math.PI * 2;
    const pose = walkPose(phase);
    // When a thigh swings forward its knee stays straight; the bend belongs
    // to the leg travelling back. Both bent at once is a crouch, not a walk.
    if (pose.thighLeft > 0.1) assert.ok(pose.kneeLeft < 0.05, `phase ${phase.toFixed(2)}`);
    if (pose.thighRight > 0.1) assert.ok(pose.kneeRight < 0.05, `phase ${phase.toFixed(2)}`);
  }
});
