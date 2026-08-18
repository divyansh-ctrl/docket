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
  CAMERA,
  paletteFor,
  DESK_UNIT,
  RIG,
  clampLookAt,
  easeDistance,
  labelDetail,
  liftAboveFloor,
  sitPose,
  standPose,
  walkPose,
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
  type Palette,
  type Point,
  type Presence,
  type Seat,
  type Zone,
} from "./office-scene";

/** Metres per second. A walk, not a march. */
const WALK_SPEED = 1.5;

/* ----------------------------------------------------------------- parts -- */

type FigureParts = Readonly<{
  root: THREE.Group;
  /** Everything above the feet, bobbed while walking. */
  body: THREE.Group;
  /** Everything above the hip, so the waist can lean and twist. */
  chest: THREE.Group;
  legLeft: THREE.Group;
  legRight: THREE.Group;
  armLeft: THREE.Group;
  armRight: THREE.Group;
  head: THREE.Group;
  pick: THREE.Mesh;
  ring: THREE.Mesh;
  marker: THREE.Mesh;
  kneeLeft: THREE.Group;
  kneeRight: THREE.Group;
  elbowLeft: THREE.Group;
  elbowRight: THREE.Group;
}>;

const SKIN = "#e0b088";

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
function makeFigure(shirt: string, waiting: number, seed = 0): FigureParts {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // A waist. The body group's origin is on the floor, so rotating it leans
  // the whole figure over like a felled tree; everything above the hip hangs
  // off this instead, and a lean rotates about the hip where a lean happens.
  // Without it the only parts of a seated figure that could move were the
  // ones with their own pivots -- the arms and the head -- which is exactly
  // how it looked.
  const chest = new THREE.Group();
  chest.position.y = RIG.hip;
  body.add(chest);

  // The wardrobe. Streetwear, not office wear: an oversized hoodie in the
  // agent's tone, baggy trousers in one of a few washes, white sneakers. The
  // variety is deterministic from the seed, so an agent keeps its fit between
  // renders instead of changing clothes every time the scene rebuilds.
  const WASHES = ["#5b6a8c", "#23252b", "#5d6146", "#6e4a42"] as const;
  const CAPS = ["#e5484d", "#3f7fbf", "#e8c14c", "#2c2c2c"] as const;
  const skinMaterial = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.82 });
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.62 });
  const trouserMaterial = new THREE.MeshStandardMaterial({
    color: WASHES[seed % WASHES.length],
    roughness: 0.9,
  });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: "#33291f", roughness: 0.9 });
  const sneakerMaterial = new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.5 });

  // Legs hang from the hip, so a rotation at the pivot swings the whole leg
  // rather than shearing it about its middle.
  const hip = RIG.hip;
  const legLeft = new THREE.Group();
  const legRight = new THREE.Group();
  const kneeLeft = new THREE.Group();
  const kneeRight = new THREE.Group();
  for (const [leg, knee, side] of [
    [legLeft, kneeLeft, -1],
    [legRight, kneeRight, 1],
  ] as const) {
    leg.position.set(side * 0.12, hip, 0);
    // Wide in the leg and stacked over the shoe, which is what makes them
    // read as denim rather than suit trousers at this resolution. Two
    // segments now: a thigh from the hip and a shin from the knee, because a
    // single rigid leg turned every sit into a beam through the desk.
    const thigh = box(0.22, RIG.limb, 0.24, trouserMaterial);
    thigh.position.y = -RIG.limb / 2;
    leg.add(thigh);
    knee.position.y = -RIG.limb;
    const shin = box(0.2, RIG.limb, 0.22, trouserMaterial);
    shin.position.y = -RIG.limb / 2;
    knee.add(shin);
    const shoe = box(0.2, 0.1, 0.3, sneakerMaterial);
    shoe.position.set(0, -0.41, 0.05);
    knee.add(shoe);
    const sole = box(0.21, 0.035, 0.31, hairMaterial);
    sole.position.set(0, -0.465, 0.05);
    knee.add(sole);
    leg.add(knee);
    body.add(leg);
  }

  const torso = box(0.52, 0.64, 0.32, shirtMaterial);
  torso.position.y = 0.32;
  chest.add(torso);

  // The kangaroo pocket and the hood are what turn a shirt into a hoodie.
  const pocket = box(0.26, 0.16, 0.03, trouserMaterial);
  pocket.position.set(0, 0.18, 0.17);
  chest.add(pocket);
  const hood = box(0.3, 0.16, 0.12, shirtMaterial);
  hood.position.set(0, 0.62, -0.19);
  chest.add(hood);

  const collar = box(0.2, 0.09, 0.2, skinMaterial);
  collar.position.y = 0.67;
  chest.add(collar);

  const armLeft = new THREE.Group();
  const armRight = new THREE.Group();
  const elbows: THREE.Group[] = [];
  for (const [arm, side] of [
    [armLeft, -1],
    [armRight, 1],
  ] as const) {
    arm.position.set(side * 0.3, 0.58, 0);
    const upper = box(0.13, 0.34, 0.14, shirtMaterial);
    upper.position.y = -0.17;
    arm.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    const fore = box(0.12, 0.24, 0.13, shirtMaterial);
    fore.position.y = -0.12;
    elbow.add(fore);
    const hand = box(0.12, 0.12, 0.13, skinMaterial);
    hand.position.y = -0.3;
    elbow.add(hand);
    arm.add(elbow);
    elbows.push(elbow);
    chest.add(arm);
  }

  const head = new THREE.Group();
  head.position.y = 0.86;
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

  // Headwear, by seed: a fitted cap, a beanie, headphones, or just the hair.
  const capMaterial = new THREE.MeshStandardMaterial({
    color: CAPS[seed % CAPS.length],
    roughness: 0.7,
  });
  if (seed % 4 === 0) {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.165, 0.09, 14), capMaterial);
    crown.position.y = 0.12;
    head.add(crown);
    const brim = box(0.2, 0.025, 0.14, capMaterial);
    brim.position.set(0, 0.085, 0.19);
    head.add(brim);
  } else if (seed % 4 === 1) {
    const beanie = new THREE.Mesh(
      new THREE.SphereGeometry(0.168, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      capMaterial,
    );
    beanie.scale.set(1, 1.25, 0.98);
    beanie.position.y = 0.03;
    head.add(beanie);
  } else if (seed % 4 === 2) {
    const band = box(0.06, 0.05, 0.34, hairMaterial);
    band.position.y = 0.14;
    band.rotation.x = Math.PI / 2;
    head.add(band);
    for (const side of [-1, 1]) {
      const puck = box(0.05, 0.11, 0.11, capMaterial);
      puck.position.set(side * 0.16, -0.01, 0);
      head.add(puck);
    }
  }
  chest.add(head);

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

  return { root, body, chest, legLeft, legRight, kneeLeft, kneeRight, armLeft, armRight, elbowLeft: elbows[0] as THREE.Group, elbowRight: elbows[1] as THREE.Group, head, pick, ring, marker };
}

/* ------------------------------------------------------------- the floor -- */

/** Warm boards, drawn once into a canvas rather than shipped as an asset. */
/**
 * The sky, painted once into a canvas and wrapped round a dome.
 *
 * A gradient rather than a photograph: a real skybox would be four megabytes of
 * image for a view nobody is looking at directly, and it would have to ship in
 * two versions to survive the dark theme. This reads the palette instead, so
 * evening outside follows evening inside.
 */
function skyTexture(palette: Palette): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, palette.sky);
    gradient.addColorStop(0.55, palette.glass);
    gradient.addColorStop(1, palette.ground);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 8, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A graffiti panel: spray blobs, a fat two-stroke tag, drips. Painted once per
 * seed into a canvas. Nothing here is legible on purpose -- readable words on a
 * wall would be one more thing demanding to be read in a view that exists to
 * be glanced at.
 */
function graffitiTexture(base: string, seed: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = base;
    context.fillRect(0, 0, 512, 256);
    // Three colours of paint, not six off a colour wheel, and painted at
    // half strength so the wall reads through them. The first pass used
    // saturated fills with radial glows, which is how you draw light rather
    // than how you draw paint -- it read as a screensaver bolted to a wall,
    // and it was the loudest thing in a room whose loudest thing should be
    // the person waiting on you.
    const SPRAY = ["#c4695c", "#5f8f96", "#c2a35c"];
    context.globalAlpha = 0.55;
    let n = seed * 104729;
    const next = () => (((n = (n * 2654435761) >>> 0) % 1000) / 1000);
    for (let blob = 0; blob < 7; blob += 1) {
      const x = 40 + next() * 432;
      const y = 40 + next() * 176;
      const radius = 26 + next() * 52;
      const colour = SPRAY[Math.floor(next() * SPRAY.length)] as string;
      // A flat blob with a soft edge: spray paint, which lands opaque in the
      // middle and thins out, rather than a light source on a wall.
      const halo = context.createRadialGradient(x, y, radius * 0.55, x, y, radius);
      halo.addColorStop(0, colour);
      halo.addColorStop(1, colour + "00");
      context.fillStyle = halo;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (let stroke = 0; stroke < 3; stroke += 1) {
      context.strokeStyle = SPRAY[Math.floor(next() * SPRAY.length)] as string;
      context.lineWidth = 10 + next() * 12;
      context.lineCap = "round";
      context.beginPath();
      const startX = 30 + next() * 200;
      const startY = 60 + next() * 140;
      context.moveTo(startX, startY);
      context.bezierCurveTo(
        startX + 60 + next() * 80, startY - 70 - next() * 40,
        startX + 140 + next() * 60, startY + 60 + next() * 40,
        startX + 220 + next() * 60, startY - 20 - next() * 30,
      );
      context.stroke();
    }
    for (let drip = 0; drip < 9; drip += 1) {
      const x = 30 + next() * 450;
      const y = 30 + next() * 120;
      context.strokeStyle = SPRAY[Math.floor(next() * SPRAY.length)] as string;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y + 14 + next() * 34);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * What is on a monitor, at the resolution a monitor is seen from here.
 *
 * Blank glowing rectangles were the other half of the staged look: an office
 * where every screen is switched on and showing nothing is a showroom. These
 * are ruled lines at the density of text and deliberately not text -- nothing
 * on a screen in this room is readable, because a screen that appeared to say
 * something would be this scene making a claim, and the whole point of the
 * office is that it only shows what is true.
 */
function screenTexture(palette: Palette): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = palette.screen;
    context.fillRect(0, 0, 256, 160);
    let n = 7919;
    const next = () => (((n = (n * 2654435761) >>> 0) % 1000) / 1000);
    context.fillStyle = palette.ink;
    context.globalAlpha = 0.3;
    // A left gutter and ragged line lengths: the silhouette of code, seen
    // from across a room, with no glyphs in it to read.
    for (let line = 0; line < 17; line += 1) {
      const indent = 12 + Math.floor(next() * 3) * 10;
      const width = 40 + next() * (196 - indent);
      context.fillRect(indent, 10 + line * 8.4, width, 3);
    }
    context.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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

/**
 * Pulls a decorative colour towards the room it is standing in.
 *
 * Props picked off a palette wheel read as stickers on a photograph: they are
 * lit by the same light as the walls but they do not belong to it. Bleeding
 * each one a third of the way towards the wall colour, and knocking a little
 * of the saturation out, is what makes furniture sit in a room. It is applied
 * to decoration only -- never to an agent's tone, never to the amber of
 * waiting on you, because those two carry meaning and must not drift.
 */
function dimmed(palette: Palette, hex: string): THREE.Color {
  const colour = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, hsl.s * 0.72, hsl.l);
  return colour.lerp(new THREE.Color(palette.wall), 0.18);
}

/** Mugs. Nobody in this office owns two of the same mug. */
const MUGS = ["#c9c3b4", "#7a8a76", "#b9704f", "#4f5a6b", "#d0b070", "#8f7f96"] as const;

/**
 * One draw call for a repeated prop.
 *
 * Every plant blade, pendant, mullion and sticky note used to be its own mesh,
 * and the renderer draws meshes one at a time however identical they are. The
 * props were most of the room's draw calls and none of its interest.
 */
function instance(
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly THREE.Matrix4[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  placements.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  // Props do not move, so three can skip re-deriving their world bounds.
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/** A placement matrix from a position, a y-rotation, and an optional scale. */
function placed(x: number, y: number, z: number, rotY = 0, scale?: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    scale ?? new THREE.Vector3(1, 1, 1),
  );
}

function buildRoom(scene: THREE.Scene, palette: Palette): void {
  const wallMaterial = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.95 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.8 });
  const deskMaterial = new THREE.MeshStandardMaterial({ color: palette.desk, roughness: 0.6 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.45, metalness: 0.55 });
  const litScreen = screenTexture(palette);
  const screenMaterial = new THREE.MeshStandardMaterial({
    map: litScreen,
    emissiveMap: litScreen,
    color: palette.screen,
    emissive: palette.screen,
    emissiveIntensity: 0.45,
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

  // Shared by the desk clutter and by the plants at the end of this function,
  // so a sprig on a desk is the same green as the tree beside it.
  const potColour = new THREE.MeshStandardMaterial({ color: dimmed(palette, "#a8623c"), roughness: 0.85 });
  const leafColour = new THREE.MeshStandardMaterial({ color: dimmed(palette, "#3f6b3a"), roughness: 0.75 });
  const paperMaterial = new THREE.MeshStandardMaterial({ color: palette.ink === "#f2ead8" ? "#cfc7b4" : "#fbf7ec", roughness: 0.95 });

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

  // Four glazed elevations, not three solid ones. The camera orbits the full
  // circle now, and a missing wall reads as a missing building rather than as
  // an open side. Glass instead of plaster because the view out is the point:
  // it is there from every desk and from every angle you can drag to.
  const PARAPET = 0.9;
  const GLASS = 3.6;

  function elevation(width: number, rotY: number, px: number, pz: number): THREE.Group {
    const group = new THREE.Group();

    const parapet = new THREE.Mesh(new THREE.BoxGeometry(width, PARAPET, 0.2), wallMaterial);
    parapet.position.y = PARAPET / 2;
    parapet.castShadow = true;
    parapet.receiveShadow = true;
    group.add(parapet);

    const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, GLASS), glassMaterial);
    pane.position.y = PARAPET + GLASS / 2;
    group.add(pane);

    const head = new THREE.Mesh(new THREE.BoxGeometry(width, 0.26, 0.24), trimMaterial);
    head.position.y = PARAPET + GLASS + 0.13;
    group.add(head);

    const mullions: THREE.Matrix4[] = [];
    for (let x = -width / 2 + 1.5; x < width / 2 - 0.2; x += 3) {
      mullions.push(placed(x, PARAPET + GLASS / 2, 0));
    }
    const mullion = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, GLASS, 0.16),
      trimMaterial,
      mullions.length,
    );
    mullions.forEach((matrix, index) => mullion.setMatrixAt(index, matrix));
    mullion.instanceMatrix.needsUpdate = true;
    mullion.frustumCulled = false;
    group.add(mullion);

    group.rotation.y = rotY;
    group.position.set(px, 0, pz);
    return group;
  }

  scene.add(elevation(FLOOR.width, 0, 0, -half.z));
  scene.add(elevation(FLOOR.width, Math.PI, 0, half.z));
  scene.add(elevation(FLOOR.depth, Math.PI / 2, -half.x, 0));
  scene.add(elevation(FLOOR.depth, -Math.PI / 2, half.x, 0));



  // The set dressing that makes it a chill room rather than a floor plan.
  //
  // Toned down from the first pass, which read as a mood board: a hot pink
  // rug, four primary-coloured bean bags and a neon sign were doing the work
  // that the room should do, and a room whose character is entirely in its
  // props is the thing that looks staged. The furniture stays; the saturation
  // comes out, so the colours that remain are the ones that mean something --
  // the agents' own tones and the amber of waiting on you.
  //
  // All deterministic, all decoration: nothing here encodes state, so nothing
  // here can lie about it.
  const graffitiA = new THREE.MeshStandardMaterial({
    map: graffitiTexture(palette.wall, 3),
    roughness: 0.95,
  });
  const graffitiB = new THREE.MeshStandardMaterial({
    map: graffitiTexture(palette.wall, 8),
    roughness: 0.95,
  });

  const featureWall = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 0.18), graffitiA);
  featureWall.position.set(11.5, 1.7, -half.z + 0.35);
  featureWall.castShadow = true;
  scene.add(featureWall);

  const intakeWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3, 5.4), graffitiB);
  intakeWall.position.set(-half.x + 0.35, 1.5, 2.5);
  intakeWall.castShadow = true;
  scene.add(intakeWall);


  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 24),
    new THREE.MeshStandardMaterial({ color: dimmed(palette, "#9a6b5c"), roughness: 1 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(COUCH.x, 0.015, COUCH.z + 2.2);
  rug.receiveShadow = true;
  scene.add(rug);

  // Fabric colours, not paint-chart colours. One draw call for all four.
  const BAGS = ["#8c6f63", "#6f7f80", "#a08a5e", "#6d6478"] as const;
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.6;
    const bag = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 16, 10),
      new THREE.MeshStandardMaterial({ color: dimmed(palette, BAGS[i]), roughness: 0.98 }),
    );
    bag.position.set(COUCH.x + Math.cos(angle) * 1.7, 0.34, COUCH.z + 2.2 + Math.sin(angle) * 1.5);
    bag.scale.set(1, 0.52, 1);
    bag.rotation.y = i * 1.7;
    scene.add(bag);
  }

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

    // Positions come from DESK_UNIT -- the same contract the seating derives
    // from and the tests hold to "chair, keyboard, screen face: one side".
    const stand = box(0.08, 0.24, 0.08, metalMaterial);
    stand.position.set(0, 0.88, DESK_UNIT.monitorZ + 0.02);
    group.add(stand);
    const monitor = box(0.86, 0.5, 0.04, metalMaterial);
    monitor.position.set(0, 1.24, DESK_UNIT.monitorZ);
    group.add(monitor);
    const glassFront = box(0.8, 0.44, 0.02, screenMaterial);
    glassFront.position.set(0, 1.24, DESK_UNIT.glassZ);
    group.add(glassFront);

    const keyboard = box(0.44, 0.02, 0.16, metalMaterial);
    keyboard.position.set(0, 0.78, DESK_UNIT.keyboardZ);
    group.add(keyboard);

    // What is on a desk is what tells you someone uses it. Six identical
    // clean desks is the single strongest tell that a room was generated;
    // this is deterministic per desk, so it is the same desk every time.
    const index = DESKS.indexOf(desk);
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.04, 0.1, 10),
      new THREE.MeshStandardMaterial({ color: MUGS[index % MUGS.length], roughness: 0.55 }),
    );
    mug.position.set(index % 2 ? 0.42 : -0.4, 0.82, DESK_UNIT.keyboardZ + 0.1);
    group.add(mug);

    if (index % 3 !== 1) {
      const paper = box(0.2, 0.008, 0.27, paperMaterial);
      paper.position.set(index % 2 ? -0.5 : 0.52, 0.775, DESK_UNIT.keyboardZ + 0.02);
      paper.rotation.y = (index % 5) * 0.17 - 0.34;
      group.add(paper);
    }

    if (index % 3 === 0) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.11, 8), potColour);
      pot.position.set(-0.68, 0.82, DESK_UNIT.monitorZ - 0.04);
      group.add(pot);
      const sprig = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), leafColour);
      sprig.position.set(-0.68, 0.96, DESK_UNIT.monitorZ - 0.04);
      group.add(sprig);
    }

    // The chair sits where the seat is, whether or not anyone is in it.
    const chair = new THREE.Group();
    chair.position.set(0, 0, DESK_UNIT.chairZ);
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
  instance(
    scene,
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    deskMaterial,
    ([
      [10.2, 4.4, 0.25, 0.2],
      [10.7, 4.2, 0.75, -0.35],
      [14.6, 4.6, 0.25, 0.6],
    ] as const).map(([x, z, y, turn]) => placed(x, y, z, turn)),
  );

  // Intake: a counter and a board, which is where a request is still just a
  // request.
  const counter = box(3.2, 1.05, 0.6, deskMaterial);
  counter.position.set(-13.7, 0.52, -1.4);
  scene.add(counter);
  const board = box(3.4, 1.9, 0.08, wallMaterial);
  board.position.set(-13.7, 1.9, -3.4);
  scene.add(board);
  const noteGeometry = new THREE.BoxGeometry(0.34, 0.34, 0.02);
  for (const [tint, parity] of [["#e0c060", 1], ["#cfe0a0", 0]] as const) {
    const places: THREE.Matrix4[] = [];
    for (let index = 0; index < 6; index += 1) {
      if (index % 2 !== parity) continue;
      places.push(placed(-14.9 + (index % 3) * 1.2, 2.4 - Math.floor(index / 3) * 0.75, -3.33));
    }
    instance(scene, noteGeometry, new THREE.MeshStandardMaterial({ color: dimmed(palette, tint), roughness: 0.9 }), places);
  }

  // Columns, in the aisles where they would really be.
  instance(
    scene,
    new THREE.CylinderGeometry(0.22, 0.22, 7, 10),
    wallMaterial,
    COLUMNS.map((column) => placed(column.x, 3.5, column.z)),
  );

  // Plants, because an office without one looks like a render of an office.
  // Four pots and twenty blades, in two draw calls rather than twenty-four.
  const pots: THREE.Matrix4[] = [];
  const blades: THREE.Matrix4[] = [];
  for (const plant of PLANTS) {
    pots.push(placed(plant.x, 0.2, plant.z));
    for (let leaf = 0; leaf < 5; leaf += 1) {
      const angle = (leaf / 5) * Math.PI * 2;
      blades.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(plant.x + Math.cos(angle) * 0.12, 0.75, plant.z + Math.sin(angle) * 0.12),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(Math.sin(angle) * -0.32, 0, Math.cos(angle) * 0.32),
          ),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    }
  }
  instance(scene, new THREE.CylinderGeometry(0.26, 0.2, 0.4, 10), potColour, pots);
  instance(scene, new THREE.ConeGeometry(0.13, 0.85, 6), leafColour, blades);

  // Hanging pendant bulbs, warm, on thin cords. The strip fixtures they
  // replace said open-plan office; a scatter of filament pendants at uneven
  // drops says somebody chose this room. Emissive rather than real lights,
  // for the same budget reason as before: the sun and the fill do the actual
  // illuminating.
  const cordMaterial = new THREE.MeshStandardMaterial({ color: "#242018", roughness: 0.9 });
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: "#ffdf9e",
    emissive: "#ffb84d",
    emissiveIntensity: palette.fixture,
    roughness: 0.3,
  });
  const cords: THREE.Matrix4[] = [];
  const bulbs: THREE.Matrix4[] = [];
  for (let i = 0; i < 12; i += 1) {
    const x = -13 + (i % 6) * 5.2 + ((i * 13) % 3) * 0.6;
    const z = i < 6 ? -4.5 : 3.5;
    const drop = 1 + ((i * 7) % 4) * 0.22;
    // The cord geometry is a unit metre scaled to each drop, which is what
    // lets twelve different lengths share one instanced mesh.
    cords.push(placed(x, 6 - drop / 2, z, 0, new THREE.Vector3(1, drop, 1)));
    bulbs.push(placed(x, 6 - drop - 0.08, z));
  }
  instance(scene, new THREE.CylinderGeometry(0.015, 0.015, 1, 5), cordMaterial, cords);
  instance(scene, new THREE.SphereGeometry(0.14, 10, 8), bulbMaterial, bulbs);

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
  /** The agent the rail and the desk panel are on, marked on the floor too. */
  selected: AgentId | null;
  /**
   * This machine asked for less motion. The room still shows every state; it
   * just stops breathing, walking and easing to get there.
   */
  calm: boolean;
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
  selected,
  calm,
  onHover,
  onOpenAgent,
  onUnavailable,
}: OfficeFloorProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  const tags = useRef<Map<AgentId, HTMLDivElement>>(new Map());

  // The loop reads these rather than closing over props: rebuilding the scene
  // on every presence change would restart every walk mid-stride.
  const live = useRef({ members, presence, hovered, selected, focus, calm, onHover, onOpenAgent });
  live.current = { members, presence, hovered, selected, focus, calm, onHover, onOpenAgent };

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
    // No shadow mapping. It produced acne and peter-panning that read as
    // rendering bugs, and the flat sprite look this room is going for does not
    // want them anyway: depth comes from tone, like the reference.
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = dark ? 1.15 : 1.0;
    renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 500);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // The gradient goes straight onto the background. There is no world out
    // there any more to hang a dome or a fog on: the office is the whole set,
    // floating on sky, exactly like the reference's floor-on-a-page.
    scene.background = skyTexture(palette);

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
    // Close enough to stand at one desk, far enough to frame the whole floor,
    // and nothing outside that range to collide with now that the office is
    // the entire set. Zooming tracks the cursor, so pointing at a corner and
    // rolling in goes to that corner rather than to the centre of the room.
    // The band is enforced by hand each frame (below) so the ends can be
    // eased rather than hit; three's own clamp is opened wide enough to stay
    // out of the way of that.
    controls.minDistance = CAMERA.minDistance;
    controls.maxDistance = CAMERA.maxDistance;
    controls.zoomSpeed = 1.15;
    controls.zoomToCursor = true;
    // The full circle. The room is glazed on all four sides with a city round
    // it, so there is no longer a back of the set to keep the camera out of.
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.45;
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

      const parts = makeFigure(shirtColour(definition.tone), state?.waitingOnYou ? 1 : 0, definition.id.length + definition.name.length * 7);
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

    // What the room actually costs, reported once on the first frame it draws.
    //
    // A budget nobody measures is a wish. This prints the real number so the
    // next person to add a prop can see what they added, and so the figure in
    // the plan is a measurement rather than an estimate.
    let reported = false;
    const from = new THREE.Vector3();
    const projected = new THREE.Vector3();
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
        // Reduced motion gets the destination, not the journey. The framing
        // still happens -- refusing to move the camera would hide the zone
        // you asked to see, which is a worse answer than moving instantly.
        const ease = state.calm ? 1 : 0.06;
        camera.position.lerp(framing.position, ease);
        controls.target.lerp(framing.target, ease);
        if (state.calm || camera.position.distanceTo(framing.position) < 0.12) framing = null;
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

        // Poses come from the pure module, where their ranges are tested.
        // This loop only applies numbers; it no longer invents them.
        // Calm freezes the clock the poses are read at, so figures hold a
        // settled posture instead of breathing. They are still *posed* --
        // seated people sit, standing people stand -- because the pose is
        // information about state, and only the animation is decoration.
        const clock = state.calm ? 0 : now;
        const beat = state.calm ? 0 : walker.phase;
        const sitting = walker.arrived && seat.seated;
        const pose = sitting
          ? sitPose(clock, beat, walker.working)
          : walker.arrived
            ? standPose(clock, beat, walker.talking)
            : walkPose(beat);

        parts.body.position.y = pose.bodyY;
        parts.chest.rotation.x = pose.torsoPitch;
        parts.chest.rotation.y = pose.torsoYaw;
        parts.legLeft.rotation.x = pose.thighLeft;
        parts.legRight.rotation.x = pose.thighRight;
        parts.kneeLeft.rotation.x = pose.kneeLeft;
        parts.kneeRight.rotation.x = pose.kneeRight;
        parts.armLeft.rotation.x = pose.armLeft;
        parts.armRight.rotation.x = pose.armRight;
        parts.elbowLeft.rotation.x = pose.elbowLeft;
        parts.elbowRight.rotation.x = pose.elbowRight;
        parts.head.rotation.x = pose.headX;
        parts.head.rotation.y = pose.headY;

        const isHovered = state.hovered === walker.id;
        const isSelected = state.selected === walker.id;
        const waiting = Boolean(presenceState?.waitingOnYou);
        parts.marker.visible = waiting;
        if (waiting && !state.calm) {
          parts.marker.rotation.y = now * 1.6;
          parts.marker.position.y = 2.34 + Math.sin(now * 2.4) * 0.07;
        }

        // The ring is how the rail and the floor become one surface: the card
        // you picked and the person it names carry the same mark, in the same
        // tone. Selection outranks hover, because hover is where the pointer
        // happens to be and selection is what you chose.
        const ringMaterial = parts.ring.material as THREE.MeshBasicMaterial;
        const pulse = state.calm ? 0.35 : 0.35 + Math.sin(now * 3) * 0.2;
        const wanted = isSelected ? 1 : isHovered ? 0.85 : waiting ? pulse : 0;
        ringMaterial.opacity += (wanted - ringMaterial.opacity) * (state.calm ? 1 : 0.2);
        // A transparent mesh is still a mesh the renderer draws. Nine rings at
        // zero opacity were nine draw calls a frame for nothing visible.
        parts.ring.visible = ringMaterial.opacity > 0.01;
        // Amber wins over the agent's own tone: waiting on you is a fact
        // about you, and it must not be dimmed by whoever happens to be
        // selected. Otherwise the ring is the agent's colour, which is the
        // colour its card is wearing.
        ringMaterial.color.set(waiting ? "#d08a2c" : shirtColour(walker.id));
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

      // The camera's three ways of ending up somewhere useless, all fixed
      // here rather than by clamps that stop it dead:
      //
      //   the look-at point dragged out of the building by zoom-to-cursor,
      //   the eye pushed under the slab by a low orbit at close range,
      //   and the wheel turning against a hard stop at either end.
      const held = clampLookAt(controls.target);
      controls.target.set(held.x, held.y, held.z);

      const offset = camera.position.clone().sub(controls.target);
      const eased = easeDistance(offset.length());
      if (Math.abs(eased - offset.length()) > 1e-4) {
        camera.position.copy(controls.target).add(offset.setLength(eased));
      }
      const lifted = liftAboveFloor(camera.position);
      if (lifted.y !== camera.position.y) camera.position.y = lifted.y;

      controls.update();
      renderer.render(scene, camera);

      if (!reported) {
        reported = true;
        const { calls, triangles } = renderer.info.render;
        // Logged in the packaged app too, not just in development: when the
        // office is slow on someone's machine this one line is the difference
        // between a diagnosis and a guess, and it costs one call per open.
        console.info(
          `office: ${calls} draw calls, ${triangles} triangles, ${members.length} figures`,
        );
      }

      // Labels last, once the camera for this frame is final. Anything behind
      // the camera projects to a mirrored point in front of it, so it is hidden
      // by the w test rather than drawn in the wrong place.
      const width = renderer.domElement.clientWidth;
      const height = renderer.domElement.clientHeight;
      for (const walker of walkers.values()) {
        const tag = tags.current.get(walker.id);
        if (!tag) continue;
        projected.set(walker.position.x, 2.25, walker.position.z);
        const range = projected.distanceTo(camera.position);
        projected.project(camera);
        const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.6 && Math.abs(projected.y) < 1.6;
        tag.dataset.visible = String(onScreen);
        // Nine names, nine intents and nine bubbles at once is a wall of text
        // over the room, and at range most of it is too small to read anyway.
        // The CSS hides what this says to drop; speech is never dropped.
        const detail = labelDetail(range);
        tag.dataset.name = String(detail.name);
        tag.dataset.intent = String(detail.intent);
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
