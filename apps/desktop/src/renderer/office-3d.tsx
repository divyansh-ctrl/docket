/**
 * The Office, as a floor you look into rather than a diagram you read.
 *
 * The plan view answers "what is the shape of the work". This answers a
 * different question -- is anything actually happening -- and it answers it the
 * way a glance through a doorway does, before you have read a single word.
 * People walk here. They walk out of a zone, down the aisle, and into the next
 * one, because a figure that teleports between states tells you a state
 * changed but never that work is moving.
 *
 * Three things keep it from being decoration:
 *
 *   Position is state, exactly as in the plan. The two views share one
 *   geometry module, so an agent at the review bench in 3D is at the review
 *   bench in the plan, always.
 *
 *   Text stays in the DOM. Names, intents and speech are HTML projected onto
 *   the scene, not textures baked into it, so they stay crisp at any zoom,
 *   selectable, and readable by a screen reader -- which a canvas is not.
 *
 *   The canvas is never the only way in. Everything you can do by clicking a
 *   figure you can also do from the roster beside it, and if WebGL is missing
 *   the whole view falls back to the plan rather than showing a black
 *   rectangle.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { agent, type AgentId } from "../shared/agent-roster";
import type { AgentTeamMember } from "../shared/ipc-contract";
import {
  AISLE_Z,
  COLUMNS,
  COUCH,
  BENCH,
  DESKS,
  FLOOR,
  PLANTS,
  ZONES,
  advanceAlong,
  headingTo,
  pathLength,
  seatFor,
  shirtColour,
  turnTowards,
  walkPath,
  zoneCentre,
  type Point,
  type Presence,
  type Seat,
  type Zone,
} from "./office-scene";

/** Metres per second. A walk, not a march. */
const WALK_SPEED = 1.5;

type Palette = Readonly<{
  background: string;
  fog: string;
  floor: string;
  plank: string;
  wall: string;
  trim: string;
  desk: string;
  metal: string;
  glass: string;
  screen: string;
  fixture: number;
  sky: string;
  ground: string;
  sun: number;
  ambient: number;
  ink: string;
  inkFaint: string;
}>;

/**
 * Daylight, or the same floor after hours.
 *
 * Dark mode here is an evening, not a blackout: warm lamps, deep walls, the
 * windows gone blue. A room drawn in grey on black stops feeling like a place
 * anyone works and starts feeling like a fault condition.
 */
function paletteFor(dark: boolean): Palette {
  return dark
    ? {
        background: "#141310",
        fog: "#141310",
        floor: "#4a3a2a",
        plank: "#3d2f22",
        wall: "#2b2721",
        trim: "#6b5f4c",
        desk: "#6a5540",
        metal: "#4c4740",
        glass: "#9fd8e8",
        screen: "#8fd9c4",
        fixture: 2.6,
        sky: "#2a3550",
        ground: "#241d15",
        sun: 0.55,
        ambient: 0.5,
        ink: "#f2ead8",
        inkFaint: "rgba(242, 234, 216, 0.6)",
      }
    : {
        background: "#efe7d6",
        fog: "#efe7d6",
        floor: "#c8a578",
        plank: "#b8946a",
        wall: "#f3ece0",
        trim: "#cfc3ac",
        desk: "#d8b98c",
        metal: "#9a938a",
        glass: "#cfe6ee",
        screen: "#dff3ea",
        fixture: 1.1,
        sky: "#fff6e6",
        ground: "#b9a headers",
        sun: 2.1,
        ambient: 1.0,
        ink: "#2f2a1f",
        inkFaint: "rgba(47, 42, 31, 0.62)",
      };
}

/* ----------------------------------------------------------------- parts -- */

type FigureParts = Readonly<{
  root: THREE.Group;
  /** Everything above the feet, bobbed while walking. */
  body: THREE.Group;
  legLeft: THREE.Group;
  legRight: THREE.Group;
  armLeft: THREE.Group;
  armRight: THREE.Group;
  head: THREE.Group;
  pick: THREE.Mesh;
  ring: THREE.Mesh;
  marker: THREE.Mesh;
}>;

const SKIN = "#e0b088";
const TROUSER = "#3d4450";

function box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * One person, articulated enough to walk and to sit.
 *
 * Deliberately blocky. A figure with real anatomy would need real animation to
 * avoid looking broken, and a stiff mannequin reads as a diagram of a person,
 * which is what this is.
 */
function makeFigure(shirt: string, waiting: number): FigureParts {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skinMaterial = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.82 });
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.72 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: TROUSER, roughness: 0.86 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: "#33291f", roughness: 0.9 });

  // Legs hang from the hip, so a rotation at the pivot swings the whole leg
  // rather than shearing it about its middle.
  const hip = 0.86;
  const legLeft = new THREE.Group();
  const legRight = new THREE.Group();
  for (const [leg, side] of [
    [legLeft, -1],
    [legRight, 1],
  ] as const) {
    leg.position.set(side * 0.12, hip, 0);
    const limb = box(0.17, 0.84, 0.19, trouserMaterial);
    limb.position.y = -0.42;
    leg.add(limb);
    const shoe = box(0.19, 0.09, 0.27, hairMaterial);
    shoe.position.set(0, -0.83, 0.04);
    leg.add(shoe);
    body.add(leg);
  }

  const torso = box(0.46, 0.62, 0.27, shirtMaterial);
  torso.position.y = hip + 0.32;
  body.add(torso);

  const collar = box(0.2, 0.09, 0.2, skinMaterial);
  collar.position.y = hip + 0.67;
  body.add(collar);

  const armLeft = new THREE.Group();
  const armRight = new THREE.Group();
  for (const [arm, side] of [
    [armLeft, -1],
    [armRight, 1],
  ] as const) {
    arm.position.set(side * 0.3, hip + 0.58, 0);
    const upper = box(0.13, 0.42, 0.14, shirtMaterial);
    upper.position.y = -0.21;
    arm.add(upper);
    const hand = box(0.12, 0.2, 0.13, skinMaterial);
    hand.position.y = -0.5;
    arm.add(hand);
    body.add(arm);
  }

  const head = new THREE.Group();
  head.position.y = hip + 0.86;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 16), skinMaterial);
  skull.castShadow = true;
  skull.scale.set(1, 1.12, 0.95);
  head.add(skull);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.163, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairMaterial,
  );
  hair.scale.set(1, 1.1, 0.98);
  hair.position.y = 0.012;
  head.add(hair);
  body.add(head);

  // The pick target: one cheap cylinder standing in for a hierarchy of small
  // meshes. Raycasting the real body would hit an arm and miss a gap between
  // the legs, which makes hovering feel unreliable for no visible reason.
  const pick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 2, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  pick.position.y = 1;
  root.add(pick);

  // The floor ring is how you find someone across the floor. It is off unless
  // the agent is hovered or is waiting on you.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 40),
    new THREE.MeshBasicMaterial({ color: shirt, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  root.add(ring);

  // A marker above the head for the one state you must not miss: blocked on a
  // decision from you.
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.15),
    new THREE.MeshStandardMaterial({ color: "#d08a2c", emissive: "#8a5310", emissiveIntensity: 0.7, roughness: 0.4 }),
  );
  marker.position.y = 2.36;
  marker.visible = waiting > 0;
  root.add(marker);

  return { root, body, legLeft, legRight, armLeft, armRight, head, pick, ring, marker };
}

/* ------------------------------------------------------------- the floor -- */

/** Warm boards, drawn once into a canvas rather than shipped as an asset. */
function plankTexture(palette: Palette): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = palette.floor;
    context.fillRect(0, 0, 512, 512);
    context.strokeStyle = palette.plank;
    context.lineWidth = 2;
    for (let y = 0; y <= 512; y += 64) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(512, y);
      context.stroke();
      // Board ends, staggered row to row, so the grain does not read as tiles.
      const offset = (y / 64) % 2 === 0 ? 0 : 128;
      for (let x = offset; x < 512; x += 256) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + 64);
        context.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 4);
  texture.anisotropy = 4;
  return texture;
}

/** A zone name, lettered onto the floor the way a floor actually is. */
function zoneLabelTexture(label: string, note: string, palette: Palette): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = palette.ink;
    context.font = "600 46px system-ui, -apple-system, Segoe UI, sans-serif";
    context.textBaseline = "top";
    context.fillText(label.toUpperCase(), 0, 8);
    context.fillStyle = palette.inkFaint;
    context.font = "400 28px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText(note, 0, 70);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function buildRoom(scene: THREE.Scene, palette: Palette): void {
  const wallMaterial = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.95 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.8 });
  const deskMaterial = new THREE.MeshStandardMaterial({ color: palette.desk, roughness: 0.6 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.45, metalness: 0.55 });
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: palette.screen,
    emissive: palette.screen,
    emissiveIntensity: 0.55,
    roughness: 0.25,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: palette.glass,
    transparent: true,
    opacity: 0.16,
    roughness: 0.06,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  const half = { x: FLOOR.width / 2, z: FLOOR.depth / 2 };

  // The slab runs past the walls on the open side, so the floor reads as one
  // floor of a building rather than a room floating in the dark.
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR.width + 14, FLOOR.depth + 12),
    new THREE.MeshStandardMaterial({ map: plankTexture(palette), roughness: 0.72 }),
  );
  slab.rotation.x = -Math.PI / 2;
  slab.position.z = 3;
  slab.receiveShadow = true;
  scene.add(slab);

  // Back and side walls only. A fourth wall would put the camera inside a box.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.width, 7), wallMaterial);
  back.position.set(0, 3.5, -half.z);
  back.receiveShadow = true;
  scene.add(back);

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.depth, 7), wallMaterial);
    wall.rotation.y = (side * -Math.PI) / 2;
    wall.position.set(side * half.x, 3.5, 0);
    wall.receiveShadow = true;
    scene.add(wall);
  }

  // Glazing along the back wall, with a lit backdrop beyond it. This is where
  // the light in the room comes from, and it is why the floor has a direction.
  const glazing = new THREE.Group();
  for (let x = -half.x + 2; x <= half.x - 2; x += 3) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 4.2), glassMaterial);
    pane.position.set(x, 3.2, -half.z + 0.06);
    glazing.add(pane);
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.4, 0.12), trimMaterial);
    mullion.position.set(x + 1.5, 3.2, -half.z + 0.06);
    glazing.add(mullion);
  }
  scene.add(glazing);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR.width + 20, 26),
    new THREE.MeshBasicMaterial({ color: palette.sky }),
  );
  backdrop.position.set(0, 6, -half.z - 8);
  scene.add(backdrop);

  // Zone inlays: a tinted panel and a lettered floor label per stage.
  for (const zone of ZONES) {
    const width = zone.x1 - zone.x0;
    const depth = zone.z1 - zone.z0;
    const inlay = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({
        color: zone.id === "waiting" ? "#d0a35a" : palette.trim,
        transparent: true,
        opacity: zone.id === "waiting" ? 0.28 : 0.16,
        roughness: 0.9,
      }),
    );
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.set(zone.x0 + width / 2, 0.012, zone.z0 + depth / 2);
    scene.add(inlay);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.85),
      new THREE.MeshBasicMaterial({ map: zoneLabelTexture(zone.label, zone.note, palette), transparent: true }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(zone.x0 + 1.8, 0.02, zone.z0 + 0.7);
    scene.add(label);
  }

  // Desks: top, legs, a monitor, a keyboard, and a chair that belongs to it.
  for (const desk of DESKS) {
    const group = new THREE.Group();
    group.position.set(desk.x, 0, desk.z);
    group.rotation.y = desk.heading;

    const top = box(1.7, 0.06, 0.85, deskMaterial);
    top.position.y = 0.74;
    group.add(top);
    for (const side of [-1, 1]) {
      const leg = box(0.06, 0.72, 0.72, metalMaterial);
      leg.position.set(side * 0.78, 0.37, 0);
      group.add(leg);
    }

    const stand = box(0.08, 0.24, 0.08, metalMaterial);
    stand.position.set(0, 0.88, -0.24);
    group.add(stand);
    const monitor = box(0.86, 0.5, 0.04, metalMaterial);
    monitor.position.set(0, 1.24, -0.26);
    group.add(monitor);
    const glassFront = box(0.8, 0.44, 0.02, screenMaterial);
    glassFront.position.set(0, 1.24, -0.23);
    group.add(glassFront);

    const keyboard = box(0.44, 0.02, 0.16, metalMaterial);
    keyboard.position.set(0, 0.78, 0.1);
    group.add(keyboard);

    // The chair sits where the seat is, whether or not anyone is in it.
    const chair = new THREE.Group();
    chair.position.set(0, 0, -0.95);
    const pan = box(0.44, 0.07, 0.44, metalMaterial);
    pan.position.y = 0.45;
    chair.add(pan);
    const backRest = box(0.42, 0.46, 0.06, metalMaterial);
    backRest.position.set(0, 0.72, -0.2);
    chair.add(backRest);
    const post = box(0.07, 0.4, 0.07, metalMaterial);
    post.position.y = 0.22;
    chair.add(post);
    group.add(chair);

    scene.add(group);
  }

  // The review bench: one long table facing a wall display.
  const bench = new THREE.Group();
  bench.position.set(BENCH.x, 0, BENCH.z);
  const benchTop = box(BENCH.width, 0.07, 0.9, deskMaterial);
  benchTop.position.y = 0.74;
  bench.add(benchTop);
  for (const side of [-1, 1]) {
    const leg = box(0.08, 0.72, 0.76, metalMaterial);
    leg.position.set(side * (BENCH.width / 2 - 0.3), 0.36, 0);
    bench.add(leg);
  }
  for (const offset of [-1.15, 1.15]) {
    const monitor = box(0.7, 0.42, 0.04, metalMaterial);
    monitor.position.set(offset, 1.05, -0.3);
    bench.add(monitor);
    const lit = box(0.64, 0.36, 0.02, screenMaterial);
    lit.position.set(offset, 1.05, -0.27);
    bench.add(lit);
  }
  scene.add(bench);

  const display = box(3.6, 2, 0.12, metalMaterial);
  display.position.set(BENCH.x, 2.4, BENCH.z - 2.2);
  scene.add(display);
  const displayLit = box(3.4, 1.84, 0.03, screenMaterial);
  displayLit.position.set(BENCH.x, 2.4, BENCH.z - 2.12);
  scene.add(displayLit);

  // The test lab: standing benches and a rack of equipment.
  for (const x of [2.3, 5.2]) {
    const station = box(1.5, 0.07, 0.8, deskMaterial);
    station.position.set(x, 1.02, 1.9);
    scene.add(station);
    for (const side of [-1, 1]) {
      const leg = box(0.07, 1, 0.7, metalMaterial);
      leg.position.set(x + side * 0.65, 0.5, 1.9);
      scene.add(leg);
    }
    const panel = box(0.9, 0.5, 0.04, screenMaterial);
    panel.position.set(x, 1.4, 1.6);
    scene.add(panel);
  }
  const rack = box(1.1, 2.1, 0.7, metalMaterial);
  rack.position.set(6.2, 1.05, 0.6);
  scene.add(rack);

  // Waiting on you: glass-walled, with something to sit on. The glass is what
  // makes it read as a room you have been put in rather than a patch of floor.
  const couch = new THREE.Group();
  couch.position.set(COUCH.x, 0, COUCH.z);
  const seatPan = box(COUCH.width, 0.32, 0.9, trimMaterial);
  seatPan.position.y = 0.4;
  couch.add(seatPan);
  const couchBack = box(COUCH.width, 0.6, 0.24, trimMaterial);
  couchBack.position.set(0, 0.78, -0.42);
  couch.add(couchBack);
  for (const side of [-1, 1]) {
    const arm = box(0.24, 0.28, 0.9, trimMaterial);
    arm.position.set((side * COUCH.width) / 2, 0.68, 0);
    couch.add(arm);
  }
  scene.add(couch);

  const table = box(1.2, 0.08, 0.7, deskMaterial);
  table.position.set(COUCH.x, 0.4, COUCH.z + 1.8);
  scene.add(table);

  const partition = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 2.6), glassMaterial);
  partition.position.set(12, 1.3, -1.5);
  scene.add(partition);
  const partitionRail = box(6.5, 0.06, 0.06, trimMaterial);
  partitionRail.position.set(12, 2.6, -1.5);
  scene.add(partitionRail);

  // Shipped: shelving and crates, so "done" has visible mass.
  const shelf = box(3.4, 1.8, 0.5, deskMaterial);
  shelf.position.set(13.4, 0.9, 0.6);
  scene.add(shelf);
  for (const [x, z, y] of [
    [10.2, 4.4, 0.25],
    [10.7, 4.2, 0.75],
    [14.6, 4.6, 0.25],
  ] as const) {
    const crate = box(0.5, 0.5, 0.5, deskMaterial);
    crate.position.set(x, y, z);
    scene.add(crate);
  }

  // Intake: a counter and a board, which is where a request is still just a
  // request.
  const counter = box(3.2, 1.05, 0.6, deskMaterial);
  counter.position.set(-13.7, 0.52, -1.4);
  scene.add(counter);
  const board = box(3.4, 1.9, 0.08, wallMaterial);
  board.position.set(-13.7, 1.9, -3.4);
  scene.add(board);
  for (let index = 0; index < 6; index += 1) {
    const note = box(0.34, 0.34, 0.02, new THREE.MeshStandardMaterial({ color: index % 2 ? "#e0c060" : "#cfe0a0", roughness: 0.9 }));
    note.position.set(-14.9 + (index % 3) * 1.2, 2.4 - Math.floor(index / 3) * 0.75, -3.33);
    scene.add(note);
  }

  // Columns, in the aisles where they would really be.
  for (const column of COLUMNS) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 12), wallMaterial);
    post.position.set(column.x, 3.5, column.z);
    post.castShadow = true;
    scene.add(post);
  }

  // Plants, because an office without one looks like a render of an office.
  const potMaterial = new THREE.MeshStandardMaterial({ color: "#a8623c", roughness: 0.85 });
  const leafMaterial = new THREE.MeshStandardMaterial({ color: "#3f6b3a", roughness: 0.75 });
  for (const plant of PLANTS) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.4, 12), potMaterial);
    pot.position.set(plant.x, 0.2, plant.z);
    pot.castShadow = true;
    scene.add(pot);
    for (let leaf = 0; leaf < 5; leaf += 1) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.85, 6), leafMaterial);
      const angle = (leaf / 5) * Math.PI * 2;
      blade.position.set(plant.x + Math.cos(angle) * 0.12, 0.75, plant.z + Math.sin(angle) * 0.12);
      blade.rotation.z = Math.cos(angle) * 0.32;
      blade.rotation.x = Math.sin(angle) * -0.32;
      blade.castShadow = true;
      scene.add(blade);
    }
  }

  // Suspended light lines. They are emissive rather than real lights: nine
  // shadow-casting fixtures would cost far more than they would show.
  const fixtureMaterial = new THREE.MeshStandardMaterial({
    color: "#fff4dd",
    emissive: "#fff0cc",
    emissiveIntensity: palette.fixture,
    roughness: 0.4,
  });
  for (const z of [-6, -1, 4]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(FLOOR.width - 6, 0.1, 0.24), fixtureMaterial);
    strip.position.set(0, 5.2, z);
    scene.add(strip);
  }

  // The aisle, marked on the floor. It is the route people actually walk, so
  // drawing it makes the movement legible instead of arbitrary.
  const aisle = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR.width - 2, 1.8),
    new THREE.MeshStandardMaterial({ color: palette.trim, transparent: true, opacity: 0.22, roughness: 0.9 }),
  );
  aisle.rotation.x = -Math.PI / 2;
  aisle.position.set(0, 0.011, AISLE_Z);
  scene.add(aisle);
}

/* ------------------------------------------------------------- the view -- */

type Walker = {
  id: AgentId;
  parts: FigureParts;
  seat: Seat;
  path: readonly Point[];
  travelled: number;
  total: number;
  position: Point;
  heading: number;
  phase: number;
  /** Set once the walk finishes, which is when sitting down is allowed. */
  arrived: boolean;
  line: THREE.Line;
  toward: AgentId | null;
  talking: boolean;
  working: boolean;
};

export type OfficeFloorProps = Readonly<{
  members: readonly AgentTeamMember[];
  presence: ReadonlyMap<AgentId, Presence>;
  hovered: AgentId | null;
  dark: boolean;
  /** Bumped to re-frame the camera on a zone. */
  focus: Readonly<{ zone: Zone | null; nonce: number }>;
  onHover: (id: AgentId | null) => void;
  onOpenAgent: (id: AgentId) => void;
  /** WebGL could not start; the container shows the plan instead. */
  onUnavailable: () => void;
}>;

export function OfficeFloor({
  members,
  presence,
  hovered,
  dark,
  focus,
  onHover,
  onOpenAgent,
  onUnavailable,
}: OfficeFloorProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  const tags = useRef<Map<AgentId, HTMLDivElement>>(new Map());

  // The loop reads these rather than closing over props: rebuilding the scene
  // on every presence change would restart every walk mid-stride.
  const live = useRef({ members, presence, hovered, focus, onHover, onOpenAgent });
  live.current = { members, presence, hovered, focus, onHover, onOpenAgent };

  useEffect(() => {
    const mount = holder.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      onUnavailable();
      return;
    }
    if (!renderer.getContext()) {
      renderer.dispose();
      onUnavailable();
      return;
    }

    const palette = paletteFor(dark);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = dark ? 1.15 : 1.0;
    renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 500);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette.background);
    scene.fog = new THREE.Fog(palette.fog, 46, 92);

    const camera = new THREE.PerspectiveCamera(
      38,
      (mount.clientWidth || 800) / (mount.clientHeight || 500),
      0.1,
      200,
    );
    camera.position.set(2, 14.5, 24);

    // A soft indoor environment for the reflections. Without it every standard
    // material falls back to flat shading and the room looks like plastic.
    let environment: THREE.Texture | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = environment;
      scene.environmentIntensity = dark ? 0.35 : 0.75;
      pmrem.dispose();
    } catch {
      // Reflections are a finish, not a requirement; the lights below carry it.
    }

    scene.add(new THREE.HemisphereLight(palette.sky, palette.ground, palette.ambient));

    const sun = new THREE.DirectionalLight("#fff1d6", palette.sun);
    sun.position.set(-9, 16, -14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    // A cool fill from the open side, so the fronts of the figures are not
    // black when the sun is behind them.
    const fill = new THREE.DirectionalLight("#dbe6ff", dark ? 0.25 : 0.55);
    fill.position.set(10, 9, 20);
    scene.add(fill);

    buildRoom(scene, palette);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, -0.5);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 9;
    controls.maxDistance = 42;
    // Never below the horizon and never straight down: both give you a view of
    // the floor that tells you nothing.
    controls.minPolarAngle = 0.45;
    controls.maxPolarAngle = 1.28;
    controls.maxAzimuthAngle = 0.85;
    controls.minAzimuthAngle = -0.85;
    controls.update();

    /* ---------------------------------------------------------- people -- */

    const walkers = new Map<AgentId, Walker>();
    const lineMaterialFor = (colour: string) =>
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.7 });

    for (const member of live.current.members) {
      const definition = agent(member.id);
      const state = live.current.presence.get(member.id);
      const zone: Zone = state?.zone ?? "desk";
      const occupants = live.current.members
        .filter((other) => (live.current.presence.get(other.id)?.zone ?? "desk") === zone)
        .map((other) => other.id);
      const seat = seatFor(zone, Math.max(0, occupants.indexOf(member.id)), occupants.length || 1);

      const parts = makeFigure(shirtColour(definition.tone), state?.waitingOnYou ? 1 : 0);
      parts.root.position.set(seat.x, 0, seat.z);
      parts.root.rotation.y = seat.heading;
      parts.root.userData.agentId = member.id;
      parts.pick.userData.agentId = member.id;
      scene.add(parts.root);

      // One reusable arc per agent for "said to". Twelve points is enough for
      // a curve and cheap enough to rewrite every frame it is visible.
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
      const line = new THREE.Line(geometry, lineMaterialFor(shirtColour(definition.tone)));
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);

      walkers.set(member.id, {
        id: member.id,
        parts,
        seat,
        path: [{ x: seat.x, z: seat.z }],
        travelled: 0,
        total: 0,
        position: { x: seat.x, z: seat.z },
        heading: seat.heading,
        phase: Math.random() * Math.PI * 2,
        arrived: true,
        line,
        toward: null,
        talking: false,
        working: false,
      });
    }

    /* -------------------------------------------------------- pointer -- */

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerInside = false;
    const pickTargets = [...walkers.values()].map((walker) => walker.parts.pick);

    const readPointer = (event: PointerEvent | MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const hitAt = (): AgentId | null => {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickTargets, false);
      return hits.length > 0 ? ((hits[0].object.userData.agentId as AgentId) ?? null) : null;
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerInside = true;
      readPointer(event);
      const hit = hitAt();
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
      if (hit !== live.current.hovered) live.current.onHover(hit);
    };

    const onPointerLeave = () => {
      pointerInside = false;
      if (live.current.hovered !== null) live.current.onHover(null);
    };

    // Click, not pointerdown: a drag that starts on a figure is an orbit, and
    // opening a session because someone rotated the camera is maddening.
    const onClick = (event: MouseEvent) => {
      readPointer(event);
      const hit = hitAt();
      if (hit) live.current.onOpenAgent(hit);
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.style.cursor = "grab";

    /* ---------------------------------------------------------- frames -- */

    const projected = new THREE.Vector3();
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const clock = new THREE.Clock();
    let lastFocus = -1;
    let framing: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const now = clock.elapsedTime;
      const state = live.current;

      // Re-frame on a zone when the sidebar asks for it.
      if (state.focus.nonce !== lastFocus) {
        lastFocus = state.focus.nonce;
        if (state.focus.zone) {
          const centre = zoneCentre(state.focus.zone);
          framing = {
            position: new THREE.Vector3(centre.x * 0.6, 8.5, centre.z + 13),
            target: new THREE.Vector3(centre.x, 1, centre.z),
          };
        } else {
          framing = {
            position: new THREE.Vector3(2, 14.5, 24),
            target: new THREE.Vector3(0, 1, -0.5),
          };
        }
      }
      if (framing) {
        camera.position.lerp(framing.position, 0.06);
        controls.target.lerp(framing.target, 0.06);
        if (camera.position.distanceTo(framing.position) < 0.12) framing = null;
      }

      // Seats are recomputed each frame from presence, which is what lets an
      // agent that is displaced by a newcomer shuffle over rather than overlap.
      const byZone = new Map<Zone, AgentId[]>();
      for (const member of state.members) {
        const zone = state.presence.get(member.id)?.zone ?? "desk";
        const list = byZone.get(zone);
        if (list) list.push(member.id);
        else byZone.set(zone, [member.id]);
      }

      for (const walker of walkers.values()) {
        const presenceState = state.presence.get(walker.id);
        const zone = presenceState?.zone ?? "desk";
        const occupants = byZone.get(zone) ?? [walker.id];
        const seat = seatFor(zone, Math.max(0, occupants.indexOf(walker.id)), occupants.length);

        // A new destination starts a walk from wherever the figure is now, not
        // from where it was supposed to be.
        if (seat.x !== walker.seat.x || seat.z !== walker.seat.z) {
          walker.seat = seat;
          walker.path = walkPath(walker.position, { x: seat.x, z: seat.z });
          walker.total = pathLength(walker.path);
          walker.travelled = 0;
          walker.arrived = walker.total < 0.02;
        }

        if (!walker.arrived) {
          walker.travelled += WALK_SPEED * delta;
          const step = advanceAlong(walker.path, walker.travelled);
          walker.position = step.point;
          walker.heading = turnTowards(walker.heading, step.heading, delta * 7);
          walker.arrived = step.done;
          walker.phase += delta * 8.5;
        } else {
          walker.heading = turnTowards(walker.heading, seat.heading, delta * 4);
          walker.phase += delta * 1.4;
        }

        walker.talking = Boolean(presenceState?.says);
        walker.working = walker.arrived && zone === "desk";
        walker.toward = presenceState?.toward ?? null;

        const parts = walker.parts;
        parts.root.position.set(walker.position.x, 0, walker.position.z);
        parts.root.rotation.y = walker.heading;

        const sitting = walker.arrived && seat.seated;
        if (sitting) {
          // Sitting is the same rig, folded: hips drop, thighs come forward,
          // and the whole figure lowers onto the chair.
          parts.body.position.y = -0.4;
          parts.legLeft.rotation.x = -Math.PI / 2;
          parts.legRight.rotation.x = -Math.PI / 2;
          const typing = walker.working ? Math.sin(now * 9 + walker.phase) * 0.06 : 0;
          parts.armLeft.rotation.x = -1.05 + typing;
          parts.armRight.rotation.x = -1.05 - typing;
          parts.head.rotation.x = 0.16 + Math.sin(now * 1.2 + walker.phase) * 0.03;
        } else if (walker.arrived) {
          // Standing: a breath, and a slow look around.
          parts.body.position.y = Math.sin(now * 1.6 + walker.phase) * 0.012;
          parts.legLeft.rotation.x = 0;
          parts.legRight.rotation.x = 0;
          const gesture = walker.talking ? Math.sin(now * 6 + walker.phase) * 0.28 : 0;
          parts.armLeft.rotation.x = -0.05 + gesture;
          parts.armRight.rotation.x = -0.05 - gesture * 0.6;
          parts.head.rotation.y = Math.sin(now * 0.7 + walker.phase) * 0.22;
          parts.head.rotation.x = 0;
        } else {
          const swing = Math.sin(walker.phase) * 0.62;
          parts.legLeft.rotation.x = swing;
          parts.legRight.rotation.x = -swing;
          parts.armLeft.rotation.x = -swing * 0.7;
          parts.armRight.rotation.x = swing * 0.7;
          parts.body.position.y = Math.abs(Math.sin(walker.phase)) * 0.035;
          parts.head.rotation.set(0, 0, 0);
        }

        const isHovered = state.hovered === walker.id;
        const waiting = Boolean(presenceState?.waitingOnYou);
        parts.marker.visible = waiting;
        if (waiting) {
          parts.marker.rotation.y = now * 1.6;
          parts.marker.position.y = 2.34 + Math.sin(now * 2.4) * 0.07;
        }

        const ringMaterial = parts.ring.material as THREE.MeshBasicMaterial;
        const wanted = isHovered ? 0.85 : waiting ? 0.35 + Math.sin(now * 3) * 0.2 : 0;
        ringMaterial.opacity += (wanted - ringMaterial.opacity) * 0.2;
        if (waiting) ringMaterial.color.set("#d08a2c");
      }

      // "Said to" arcs, drawn between heads. Only while someone is speaking, so
      // the floor is not permanently webbed with lines.
      for (const walker of walkers.values()) {
        const listener = walker.toward ? walkers.get(walker.toward) : null;
        if (!listener || !walker.talking) {
          walker.line.visible = false;
          continue;
        }
        walker.line.visible = true;
        from.set(walker.position.x, 1.95, walker.position.z);
        to.set(listener.position.x, 1.95, listener.position.z);
        const positions = walker.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        const lift = Math.min(1.6, from.distanceTo(to) * 0.18);
        for (let index = 0; index < 12; index += 1) {
          const t = index / 11;
          positions.setXYZ(
            index,
            from.x + (to.x - from.x) * t,
            from.y + Math.sin(t * Math.PI) * lift,
            from.z + (to.z - from.z) * t,
          );
        }
        positions.needsUpdate = true;
        walker.line.geometry.computeBoundingSphere();
        (walker.line.material as THREE.LineBasicMaterial).opacity = 0.45 + Math.sin(now * 4) * 0.2;
      }

      controls.update();
      renderer.render(scene, camera);

      // Labels last, once the camera for this frame is final. Anything behind
      // the camera projects to a mirrored point in front of it, so it is hidden
      // by the w test rather than drawn in the wrong place.
      const width = renderer.domElement.clientWidth;
      const height = renderer.domElement.clientHeight;
      for (const walker of walkers.values()) {
        const tag = tags.current.get(walker.id);
        if (!tag) continue;
        projected.set(walker.position.x, 2.25, walker.position.z).project(camera);
        const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.6 && Math.abs(projected.y) < 1.6;
        tag.dataset.visible = String(onScreen);
        if (!onScreen) continue;
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        // Nearer figures label over farther ones, which is the same order the
        // scene itself draws them in.
        tag.style.zIndex = String(Math.round((1 - projected.z) * 1000));
      }
      void pointerInside;
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();

      // Electron keeps this process alive for as long as the app is open, so a
      // scene that is opened and closed twenty times has to give everything
      // back. Traversing is the only way to be sure nothing was missed.
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material;
        if (Array.isArray(material)) for (const entry of material) entry.dispose();
        else if (material) {
          const textured = material as THREE.MeshStandardMaterial;
          textured.map?.dispose();
          material.dispose();
        }
      });
      environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // The scene is built once per theme. Presence, hover and focus reach the
    // loop through the ref above, so none of them belong in this list.
  }, [dark, members, onUnavailable]);

  return (
    <div className="stage">
      <div className="stageCanvas" ref={holder} />
      <div className="stageOverlay" ref={overlay} aria-hidden="true">
        {members.map((member) => {
          const definition = agent(member.id);
          const state = presence.get(member.id);
          return (
            <div
              key={member.id}
              className="tag"
              data-hovered={hovered === member.id}
              data-waiting={Boolean(state?.waitingOnYou)}
              ref={(node) => {
                if (node) tags.current.set(member.id, node);
                else tags.current.delete(member.id);
              }}
            >
              {state?.says ? <span className="tagSays">{state.says}</span> : null}
              <span className="tagName" data-tone={definition.tone}>
                {definition.name}
              </span>
              {hovered === member.id && state?.intent ? <span className="tagIntent">{state.intent}</span> : null}
            </div>
          );
        })}
      </div>
      <p className="stageHint">Drag to look · scroll to zoom · click an agent to open its session</p>
    </div>
  );
}

/** Whether this renderer can show the 3D floor at all. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

void headingTo;
