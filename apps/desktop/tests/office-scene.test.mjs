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
        // A knee flexes to about 140 degrees, not 90. The old square limit
        // was a conservative stand-in written when no pose approached it;
        // tucking a seated foot back under the chair needs past square, and
        // that motion is real, so the stop moves to the anatomical one.
        assert.ok(knee <= 2.45, `a knee folded past its stop: ${knee}`);
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
  // And it stays there while breathing: a chair the sitter sinks through or
  // hovers over is the same defect as the old remembered constant, slower.
  for (let step = 0; step < 200; step += 1) {
    const breathing = sitPose(step * 0.21, step * 0.13, step % 2 === 0);
    const gap = RIG.hip + breathing.bodyY - RIG.panTop;
    assert.ok(Math.abs(gap) < 0.02, `hip drifted ${gap.toFixed(3)} from the pan`);
  }
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

/* ------------------------------------------------- a body, not two hands -- */

/** The range of one pose field over a long stretch of time. */
function rangeOver(pose, field, seconds = 24) {
  let low = Infinity;
  let high = -Infinity;
  for (let step = 0; step < 400; step += 1) {
    const value = pose((step / 400) * seconds)[field];
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return high - low;
}

test("a seated agent moves more than its hands", async () => {
  const { sitPose } = jiti("../src/renderer/office-scene.ts");
  const seated = (time) => sitPose(time, 0.8, true);

  // The reported defect, as an assertion: watching the floor showed agents
  // whose only moving part was a pair of vibrating hands. That was literally
  // true of the old pose -- the arms and the head were the only fields that
  // were functions of time, and the hip, the torso and the legs were
  // constants. Every one of these fields must now carry motion.
  for (const [field, least] of [
    ["bodyY", 0.02],
    ["torsoPitch", 0.1],
    ["torsoYaw", 0.05],
    ["headY", 0.15],
    ["kneeLeft", 0.05],
  ]) {
    const range = rangeOver(seated, field);
    assert.ok(range >= least, `${field} moved ${range.toFixed(3)}, wanted ${least}`);
  }
});

test("typing comes in bursts with real pauses, not a constant vibration", async () => {
  const { typingBurst } = jiti("../src/renderer/office-scene.ts");

  let idle = 0;
  let full = 0;
  for (let step = 0; step < 500; step += 1) {
    const value = typingBurst(step * 0.05, 0.4);
    assert.ok(value >= 0 && value <= 1, `burst out of range: ${value}`);
    if (value === 0) idle += 1;
    if (value === 1) full += 1;
  }
  // Both states have to be a real share of the time. A burst that is always
  // on is the metronome this replaced; one that is always off is a corpse.
  assert.ok(idle > 100, `only ${idle} idle samples`);
  assert.ok(full > 100, `only ${full} typing samples`);
});

test("the floor does not type in unison", async () => {
  const { typingBurst } = jiti("../src/renderer/office-scene.ts");
  // Nine agents, nine phases: at some moment some are typing and some are not.
  // A room where everyone starts and stops together is a screensaver.
  let split = 0;
  for (let step = 0; step < 400; step += 1) {
    const time = step * 0.1;
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => typingBurst(time, i * 0.7));
    if (values.some((v) => v > 0.5) && values.some((v) => v < 0.5)) split += 1;
  }
  assert.ok(split > 300, `agents were in lockstep for all but ${split} samples`);
});

/* ---------------------------------------------------------------- camera -- */

test("zooming eases into its stops and never reverses", async () => {
  const { easeDistance, CAMERA } = jiti("../src/renderer/office-scene.ts");

  let previous = -Infinity;
  for (let step = 0; step <= 600; step += 1) {
    const requested = -5 + (step / 600) * 50;
    const eased = easeDistance(requested);
    // Inside the band, always. A camera that eases out of its own limits is
    // worse than one that stops dead at them.
    assert.ok(eased >= CAMERA.minDistance - 1e-9, `eased below the floor: ${eased}`);
    assert.ok(eased <= CAMERA.maxDistance + 1e-9, `eased past the ceiling: ${eased}`);
    // Monotonic: turning the wheel one way never moves the view the other.
    assert.ok(eased >= previous - 1e-9, `wheel reversed at ${requested}`);
    previous = eased;
  }

  // The middle of the range is untouched -- easing is for the ends only.
  const middle = (CAMERA.minDistance + CAMERA.maxDistance) / 2;
  assert.equal(easeDistance(middle), middle);

  // And the soft zone actually softens: a metre of wheel near the stop moves
  // the camera less than a metre of wheel in open range.
  const nearStop = easeDistance(CAMERA.minDistance + 1) - easeDistance(CAMERA.minDistance + 0.5);
  assert.ok(nearStop < 0.5, `no softening near the stop: ${nearStop}`);
});

test("the look-at point cannot be scrolled out of the building", async () => {
  const { clampLookAt, CAMERA, FLOOR } = jiti("../src/renderer/office-scene.ts");

  // zoom-to-cursor drags the target at whatever the pointer was over, and the
  // pointer is often over the sky. Unclamped, that walks the view out of the
  // room one scroll at a time with no way back.
  for (const wild of [
    { x: 900, y: 400, z: -900 },
    { x: -900, y: -400, z: 900 },
    { x: 0, y: 0, z: 0 },
  ]) {
    const point = clampLookAt(wild);
    assert.ok(Math.abs(point.x) <= FLOOR.width / 2 + CAMERA.targetPad + 1e-9);
    assert.ok(Math.abs(point.z) <= FLOOR.depth / 2 + CAMERA.targetPad + 1e-9);
    assert.ok(point.y >= CAMERA.targetMinY && point.y <= CAMERA.targetMaxY);
  }

  // A point already on the floor is left exactly alone.
  const inside = { x: 2, y: 1, z: -3 };
  assert.deepEqual(clampLookAt(inside), inside);
});

test("the camera never gets under the floor", async () => {
  const { liftAboveFloor, CAMERA } = jiti("../src/renderer/office-scene.ts");
  assert.equal(liftAboveFloor({ x: 1, y: -4, z: 2 }).y, CAMERA.floorClearance);
  assert.deepEqual(liftAboveFloor({ x: 1, y: 9, z: 2 }), { x: 1, y: 9, z: 2 });
});

test("text thins out with distance, but speech never does", async () => {
  const { labelDetail, LABEL_LOD } = jiti("../src/renderer/office-scene.ts");

  const close = labelDetail(3);
  assert.deepEqual(close, { name: true, intent: true, says: true });

  const mid = labelDetail(LABEL_LOD.intent + 1);
  assert.equal(mid.intent, false, "intent should drop before the name does");
  assert.equal(mid.name, true);

  const far = labelDetail(LABEL_LOD.name + 1);
  assert.equal(far.name, false);

  // What an agent actually said is the one thing on this surface that is not
  // derivable from the picture, so it survives every distance.
  for (const distance of [0, 5, 20, 50, 500]) {
    assert.equal(labelDetail(distance).says, true, `speech dropped at ${distance}`);
  }
});

/* -------------------------------------------------------------- palettes -- */

test("every colour in both palettes is a colour", async () => {
  const { paletteFor } = jiti("../src/renderer/office-scene.ts");

  // The light palette shipped `ground: "#b9a headers"` from the day the scene
  // was written. Three does not throw on an unparseable colour -- it warns
  // and leaves the material black -- so the room was quietly wrong and the
  // only way to find it was to read the line. This is that line, checked.
  const COLOURS = [
    "background", "fog", "floor", "plank", "wall", "trim",
    "desk", "metal", "glass", "screen", "sky", "ground", "ink",
  ];
  for (const dark of [true, false]) {
    const palette = paletteFor(dark);
    for (const field of COLOURS) {
      assert.match(
        palette[field],
        /^#[0-9a-f]{6}$/i,
        `${dark ? "dark" : "light"} palette: ${field} is "${palette[field]}"`,
      );
    }
    // inkFaint carries an alpha, so it is rgba rather than hex.
    assert.match(palette.inkFaint, /^rgba\(/, `${dark ? "dark" : "light"}: inkFaint`);
    for (const field of ["fixture", "sun", "ambient"]) {
      assert.ok(
        Number.isFinite(palette[field]) && palette[field] >= 0,
        `${field} is ${palette[field]}`,
      );
    }
  }

  // And the two are actually different lightings, not one palette twice.
  assert.notEqual(paletteFor(true).wall, paletteFor(false).wall);
});
