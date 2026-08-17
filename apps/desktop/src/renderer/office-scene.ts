/**
 * The floor, in world coordinates. One unit is one metre.
 *
 * Everything here is arithmetic: where a zone sits, which seat an agent takes,
 * the route it walks to get there, and how far along that route it is at a
 * given moment. None of it imports three, which is the point -- the geometry
 * that decides what you see is verifiable in a plain node test, and the WebGL
 * module is left holding only meshes and materials.
 *
 * Three rules the numbers enforce:
 *
 *   Metric scale throughout. A 1.8m person beside a 1.7m desk reads as an
 *   office; the same person beside a 4m desk reads as a toy, and no amount of
 *   lighting fixes it afterwards.
 *
 *   A person never stands inside furniture. Seats are derived from the same
 *   table the desks are built from, so a chair cannot drift away from its desk
 *   when the layout changes.
 *
 *   A person never walks through a desk. Travel between zones is routed along
 *   the circulation aisle, the way it would be on a real floor, rather than
 *   straight-lined across whatever is in between.
 */
import type { AgentId } from "../shared/agent-roster";

/** The floorplate: an open floor for a team of nine, not a single room. */
export const FLOOR = Object.freeze({ width: 34, depth: 20 });

/** The main circulation aisle, running the width of the floor at the front. */
export const AISLE_Z = 7.5;

/** The stage an agent is in. Position on the floor IS this state. */
export type Zone = "intake" | "desk" | "review" | "lab" | "waiting" | "shipped";

export type Point = Readonly<{ x: number; z: number }>;

export type Presence = Readonly<{
  id: AgentId;
  /** Where the agent is, which is a statement about its state. */
  zone: Zone;
  /** One short line: what it is doing right now. */
  intent: string;
  /** Said out loud, shown as a bubble. Cleared when it stops talking. */
  says: string | null;
  /** Addressed to another agent, which draws the line between them. */
  toward: AgentId | null;
  blocked: boolean;
  /** Needs a human decision before it can continue. */
  waitingOnYou: boolean;
}>;

export type ZoneRect = Readonly<{
  id: Zone;
  label: string;
  /** The stage in one line. */
  note: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}>;

/**
 * Laid out as a pipeline running left to right: work arrives at intake, is
 * built at the desks, is judged at review and proven in the lab, and leaves by
 * shipped -- unless it needs you, in which case it stops at waiting.
 *
 * This is what makes the floor worth looking at rather than a list. A queue
 * piling up at review while the lab stands empty is a fact about your work
 * that no status column shows you.
 */
export const ZONES: readonly ZoneRect[] = Object.freeze([
  { id: "intake", label: "Intake", note: "Requests, before anyone owns them", x0: -16, x1: -11.5, z0: -4, z1: 3 },
  { id: "desk", label: "Desks", note: "Work in progress", x0: -10.5, x1: -0.5, z0: -8, z1: 4.5 },
  { id: "review", label: "Review bench", note: "Diffs being read", x0: 0.5, x1: 7, z0: -8, z1: -1.5 },
  { id: "lab", label: "Test lab", note: "Checks being run", x0: 0.5, x1: 7, z0: 0, z1: 5.5 },
  { id: "waiting", label: "Waiting on you", note: "Stopped until you decide", x0: 8, x1: 16, z0: -8, z1: -1.5 },
  { id: "shipped", label: "Shipped", note: "Done and proven", x0: 8, x1: 16, z0: 0, z1: 5.5 },
]);

const ZONE_BY_ID = new Map<Zone, ZoneRect>(ZONES.map((zone) => [zone.id, zone]));

export function zoneRect(id: Zone): ZoneRect {
  return ZONE_BY_ID.get(id) ?? (ZONE_BY_ID.get("desk") as ZoneRect);
}

export function zoneCentre(id: Zone): Point {
  const zone = zoneRect(id);
  return { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
}

/* ------------------------------------------------------------- furniture -- */

export type Desk = Readonly<{ x: number; z: number; heading: number }>;

/**
 * Three loose pods, each at its own angle, instead of two parade rows.
 *
 * Rows facing the same way read as cubicle farm no matter what the furniture
 * looks like: the grid is the tell. Turning the pods and letting people face
 * each other is what makes the same six desks read as a studio.
 */
export const DESKS: readonly Desk[] = Object.freeze([
  { x: -8.6, z: -5.4, heading: Math.PI * 0.85 },
  { x: -6.9, z: -3.9, heading: -Math.PI * 0.15 },
  { x: -3.2, z: -5.8, heading: Math.PI * 1.2 },
  { x: -8.4, z: 1.4, heading: Math.PI * 0.62 },
  { x: -6.6, z: 3, heading: -Math.PI * 0.38 },
  { x: -2.6, z: 1.2, heading: Math.PI * 0.95 },
]);

export const BENCH = Object.freeze({ x: 3.75, z: -5.6, width: 4.6 });
export const COUCH = Object.freeze({ x: 12, z: -5.2, width: 3.6 });

export const PLANTS: readonly Point[] = Object.freeze([
  { x: -16.2, z: 6 },
  { x: -0.6, z: 6.4 },
  { x: 16.4, z: -8.6 },
  { x: 7.6, z: 6.4 },
]);

/** Structural columns. They stand in the aisles, never inside a zone. */
export const COLUMNS: readonly Point[] = Object.freeze([
  { x: -11, z: 6.6 },
  { x: 0, z: 6.6 },
  { x: 7.5, z: -8.8 },
]);

/* ----------------------------------------------------------------- seats -- */

export type Seat = Readonly<{
  x: number;
  z: number;
  heading: number;
  /** Sitting at a surface, rather than standing. */
  seated: boolean;
}>;

/**
 * Where each zone puts the people in it. Derived from the furniture above, so
 * a seat cannot end up somewhere there is nothing to sit at.
 */
const SEATS: Readonly<Record<Zone, readonly Seat[]>> = Object.freeze({
  // A desk seat sits on the near side of its desk, facing the screen.
  desk: Object.freeze(DESKS.map((desk) => ({ x: desk.x, z: desk.z + 0.95, heading: desk.heading, seated: true }))),
  intake: Object.freeze([
    { x: -14.6, z: 0.4, heading: Math.PI, seated: false },
    { x: -12.6, z: 1.2, heading: Math.PI, seated: false },
    { x: -13.6, z: 2.4, heading: Math.PI, seated: false },
  ]),
  review: Object.freeze([
    { x: 2.6, z: -4.6, heading: Math.PI, seated: true },
    { x: 4.9, z: -4.6, heading: Math.PI, seated: true },
    { x: 6.3, z: -3, heading: Math.PI, seated: false },
  ]),
  lab: Object.freeze([
    { x: 2.3, z: 3, heading: Math.PI, seated: false },
    { x: 5.2, z: 3, heading: Math.PI, seated: false },
    { x: 3.8, z: 4.6, heading: Math.PI, seated: false },
  ]),
  waiting: Object.freeze([
    { x: 10.8, z: -4.2, heading: 0, seated: true },
    { x: 13.2, z: -4.2, heading: 0, seated: true },
    { x: 12, z: -2.6, heading: 0, seated: false },
  ]),
  shipped: Object.freeze([
    { x: 10, z: 3, heading: Math.PI, seated: false },
    { x: 13, z: 3.4, heading: Math.PI, seated: false },
    { x: 15, z: 2.2, heading: Math.PI, seated: false },
  ]),
});

/**
 * The seat an agent takes. Past the built seats it falls back to standing room
 * spread across the zone: nine agents in one zone is unusual, but it must not
 * stack all nine on one chair.
 */
export function seatFor(zone: Zone, index: number, total: number): Seat {
  const seats = SEATS[zone] ?? SEATS.desk;
  if (index < seats.length) return seats[index];

  const rect = zoneRect(zone);
  const overflow = Math.max(1, total - seats.length);
  const position = index - seats.length;
  const columns = Math.min(3, overflow);
  const rows = Math.ceil(overflow / columns);
  const column = position % columns;
  const row = Math.floor(position / columns);
  return {
    x: rect.x0 + ((rect.x1 - rect.x0) * (column + 0.5)) / columns,
    z: rect.z0 + ((rect.z1 - rect.z0) * (row + 0.5)) / rows,
    heading: Math.PI,
    seated: false,
  };
}

/** How many built seats a zone has, before anyone has to stand. */
export function seatCount(zone: Zone): number {
  return (SEATS[zone] ?? []).length;
}

/* ------------------------------------------------------------- movement -- */

export function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/** Yaw for a figure whose forward is +z, which is how the meshes are built. */
export function headingTo(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** The shortest signed turn between two yaws, so nobody spins the long way. */
export function turnTowards(current: number, target: number, maximum: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + Math.max(-maximum, Math.min(maximum, delta));
}

/** Which zone a point falls in, or null for the aisles between them. */
export function zoneAt(point: Point): Zone | null {
  for (const zone of ZONES) {
    if (point.x >= zone.x0 && point.x <= zone.x1 && point.z >= zone.z0 && point.z <= zone.z1) return zone.id;
  }
  return null;
}

/**
 * The route between two points.
 *
 * Within one zone people cross it directly. Between zones they step out to the
 * aisle, walk along it, and come back in -- which is both how a floor actually
 * works and the only thing stopping an agent from walking through six desks on
 * its way to the review bench.
 */
export function walkPath(from: Point, to: Point): readonly Point[] {
  const origin = zoneAt(from);
  if ((origin !== null && origin === zoneAt(to)) || distance(from, to) < 2) return [from, to];
  return [from, { x: from.x, z: AISLE_Z }, { x: to.x, z: AISLE_Z }, to];
}

export function pathLength(path: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) total += distance(path[index - 1], path[index]);
  return total;
}

/**
 * Where a walker is after covering `travelled` metres of a route, and which way
 * it faces. Heading comes from the segment being walked rather than from the
 * endpoint, so a figure turns at each corner instead of sliding sideways down
 * the aisle.
 */
export function advanceAlong(
  path: readonly Point[],
  travelled: number,
): Readonly<{ point: Point; heading: number; done: boolean }> {
  if (path.length === 0) return { point: { x: 0, z: 0 }, heading: 0, done: true };
  if (path.length === 1) return { point: path[0], heading: 0, done: true };

  let remaining = Math.max(0, travelled);
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const length = distance(start, end);
    if (length === 0) continue;
    if (remaining <= length) {
      const ratio = remaining / length;
      return {
        point: { x: start.x + (end.x - start.x) * ratio, z: start.z + (end.z - start.z) * ratio },
        heading: headingTo(start, end),
        done: false,
      };
    }
    remaining -= length;
  }

  const last = path[path.length - 1];
  const previous = path[path.length - 2];
  return { point: last, heading: headingTo(previous, last), done: true };
}

/* --------------------------------------------------------------- colour -- */

/**
 * The agent tones, lifted for use as cloth.
 *
 * The interface palette is ink on paper, so the tones are dark enough to read
 * as text on it. Applied straight to a lit surface those same values come out
 * as mud; lifting them keeps each agent the colour it is everywhere else in
 * the app while letting the room stay warm rather than grim.
 */
export const TONE_HEX: Readonly<Record<string, string>> = Object.freeze({
  lead: "#1d4d3a",
  engineer: "#2f5d7c",
  review: "#5b3a6b",
  tests: "#7c4a2f",
  docs: "#6f5318",
  security: "#8a2f24",
  interface: "#26605d",
  data: "#4a4a7c",
  release: "#554d3e",
});

export function lighten(hex: string, amount: number): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const channel = (shift: number) => {
    const base = (value >> shift) & 0xff;
    return Math.round(base + (255 - base) * amount);
  };
  const out = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${out.toString(16).padStart(6, "0")}`;
}

/** Shirt colour for an agent tone; an unknown tone gets a neutral, not black. */
export function shirtColour(tone: string): string {
  return lighten(TONE_HEX[tone] ?? "#554d3e", 0.34);
}
