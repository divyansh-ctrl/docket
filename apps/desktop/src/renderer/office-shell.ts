/**
 * The shell around the floor, as arithmetic.
 *
 * The office is three regions -- the floor, the rail of agents, the desk you
 * talk through -- and what binds them is a handful of derivations: what word
 * describes an agent's state, how many are standing in each zone, and whether
 * this machine wants the room to move at all. All three used to live inside
 * the view, where nothing could reach them.
 *
 * The rule they share is the one the whole surface is built on: every value
 * here is derived from a recorded presence and nothing else. There is no
 * branch that invents a status, no count that includes an agent who is not
 * there, and no field that can show a number nobody measured.
 */
import type { AgentId } from "../shared/agent-roster";
import type { Presence, Zone } from "./office-scene";
import { ZONES } from "./office-scene";

export type StatusTone = "working" | "blocked" | "waiting" | "idle";

export type Status = Readonly<{ label: string; tone: StatusTone }>;

/**
 * Where an agent stands, as a word.
 *
 * Ordered by what a reviewer must not miss. Waiting on you outranks blocked
 * because one of them is your move and the other is not; blocked outranks
 * working because an agent can be both and only one of those facts is worth
 * your attention. An agent with no recorded intent is idle, which is a
 * statement about the record rather than about the agent -- there is nothing
 * else honest to say.
 */
export function statusOf(presence: Presence): Status {
  if (presence.waitingOnYou) return { label: "waiting on you", tone: "waiting" };
  if (presence.blocked) return { label: "blocked", tone: "blocked" };
  if (presence.zone === "shipped") return { label: "shipped", tone: "idle" };
  if (presence.intent) return { label: "working", tone: "working" };
  return { label: "idle", tone: "idle" };
}

export type ZoneTally = Readonly<{
  id: Zone;
  label: string;
  /** The stage in one line, from the same place the label comes from. */
  note: string;
  count: number;
  /** True when someone here is stopped on a decision from you. */
  needsYou: boolean;
}>;

/**
 * How many agents are standing in each stage, in pipeline order.
 *
 * Always every zone, including the empty ones. An empty test lab beside a
 * review bench with four people in it is the fact worth seeing, and a tally
 * that hides its zeroes hides exactly that.
 */
export function tallyZones(
  entries: ReadonlyArray<Readonly<{ id: AgentId; presence: Presence }>>,
): readonly ZoneTally[] {
  return ZONES.map((zone) => {
    const here = entries.filter((entry) => entry.presence.zone === zone.id);
    return {
      id: zone.id,
      label: zone.label,
      note: zone.note,
      count: here.length,
      needsYou: here.some((entry) => entry.presence.waitingOnYou),
    };
  });
}

/**
 * One line describing the floor, for the header and for screen readers.
 *
 * Says what is true and stops. "Nine agents, three waiting on you" is worth a
 * glance; "the team is hard at work" is a mood, and a mood is the one thing
 * this surface is not allowed to report.
 */
export function describeFloor(
  entries: ReadonlyArray<Readonly<{ id: AgentId; presence: Presence }>>,
): string {
  if (entries.length === 0) return "No agents on this floor yet";
  const waiting = entries.filter((entry) => entry.presence.waitingOnYou).length;
  const blocked = entries.filter((entry) => entry.presence.blocked && !entry.presence.waitingOnYou).length;
  const people = `${entries.length} ${entries.length === 1 ? "agent" : "agents"}`;
  const parts = [people];
  if (waiting > 0) parts.push(`${waiting} waiting on you`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  return parts.join(" · ");
}
