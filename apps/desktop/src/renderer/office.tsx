/**
 * The Office: the workspace as a room you can look at.
 *
 * The channel view answers "what was said". This answers the question you
 * actually have when six agents are running at once -- who is busy, who is
 * stuck, and who is waiting on me -- in one glance, without reading anything.
 *
 * Two rules keep it honest:
 *
 *   Position means something. Desks are work, the meeting room is a handoff
 *   between two agents, and the waiting room holds anyone blocked on you. An
 *   agent moves because its state changed, never for decoration.
 *
 *   Live and demonstration are never mixed. With a session running, every
 *   figure is driven by real subagent events. With nothing running, the floor
 *   plays a scripted loop so the room is legible before you have used it, and
 *   says so in the header rather than implying work is happening.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { agent, type AgentId } from "../shared/agent-roster";
import type { AgentTeamMember } from "../shared/ipc-contract";

/**
 * The floor is a pipeline, laid out left to right.
 *
 * This is the part that earns the view. A dashboard can tell you an agent is
 * blocked; a floor tells you the queue is piling up at review while the test
 * lab sits empty, which is a different and more useful fact. Where someone is
 * standing IS their state, so the shape of the work is visible before you read
 * a single word.
 *
 * What a zone *is* -- its id, its name, the one line describing the stage --
 * is decided once, in the scene module, and re-exported here. It used to be
 * written out twice, identically, in this file and in that one: two lists
 * that happened to agree, with nothing to keep them agreeing. That is the
 * same defect the seats had before they were derived from the desks, and it
 * would have shipped the moment somebody renamed a stage in one file.
 *
 * This view adds the only thing the scene module has no opinion about: where
 * each zone sits on a flat plan, as percentages of the plate.
 */
export type { Presence, Zone } from "./office-scene";

import { ZONES as STAGES } from "./office-scene";
import type { Presence, Zone } from "./office-scene";

/** Where each stage sits on the flat plan, as percentages. */
const PLAN: Readonly<Record<Zone, Readonly<{ left: number; top: number; width: number; height: number }>>> =
  Object.freeze({
    intake: { left: 3, top: 34, width: 13, height: 32 },
    desk: { left: 18, top: 12, width: 34, height: 76 },
    review: { left: 54, top: 12, width: 20, height: 36 },
    lab: { left: 54, top: 52, width: 20, height: 36 },
    waiting: { left: 76, top: 12, width: 21, height: 36 },
    shipped: { left: 76, top: 52, width: 21, height: 36 },
  });

export const ZONES: ReadonlyArray<
  Readonly<{ id: Zone; label: string; note: string; left: number; top: number; width: number; height: number }>
> = Object.freeze(
  STAGES.map((stage) => ({ id: stage.id, label: stage.label, note: stage.note, ...PLAN[stage.id] })),
);

const ZONE_BY_ID = new Map(ZONES.map((zone) => [zone.id, zone]));

/** Spreads however many agents are in a zone across it without overlapping. */
function placeInZone(zoneId: Zone, position: number, total: number): { left: number; top: number } {
  const zone = ZONE_BY_ID.get(zoneId) ?? ZONE_BY_ID.get("desk");
  if (!zone) return { left: 50, top: 50 };
  const columns = Math.max(1, Math.min(2, Math.ceil(total / 3)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = position % columns;
  const row = Math.floor(position / columns);
  return {
    left: zone.left + (zone.width * (column + 0.5)) / columns,
    top: zone.top + (zone.height * (row + 0.5)) / rows,
  };
}

function seatOf(presence: Presence, occupants: readonly AgentId[]): { left: number; top: number } {
  const position = Math.max(0, occupants.indexOf(presence.id));
  return placeInZone(presence.zone, position, occupants.length || 1);
}

/**
 * The scripted loop shown before any real session has run. Written as beats so
 * it reads like a shift rather than a random walk: work, a handoff, a finding,
 * a block that needs a person.
 */
const DEMO: ReadonlyArray<ReadonlyArray<Partial<Presence> & { id: AgentId }>> = [
  [
    { id: "lead", zone: "intake", intent: "Splitting the request into units", says: "Three units. Token store first." },
    { id: "engineer", zone: "desk", intent: "Reading src/auth before touching it" },
    { id: "review", zone: "review", intent: "Bench empty" },
    { id: "tests", zone: "lab", intent: "Nothing to run yet" },
  ],
  [
    { id: "lead", zone: "desk", intent: "Handing the unit to Vega", says: "@engineer single-use refresh, one file.", toward: "engineer" },
    { id: "engineer", zone: "desk", intent: "Taking the brief", says: "Rotation only. Got it." },
  ],
  [
    { id: "engineer", zone: "desk", intent: "Writing the reuse guard in refresh.ts" },
    { id: "tests", zone: "lab", intent: "Writing the concurrent-refresh case", says: "Two requests, one token." },
    { id: "lead", zone: "intake", intent: "Scoping the second unit" },
  ],
  [
    { id: "engineer", zone: "review", intent: "4 files changed, on the bench" },
    { id: "review", zone: "review", intent: "Reading the diff", says: "Reading 4 files." },
    { id: "tests", zone: "lab", intent: "41 of 42 passing" },
  ],
  [
    { id: "review", zone: "review", intent: "Raising a finding", says: "Concurrent refresh still reuses. DOC-4.", toward: "engineer" },
    { id: "engineer", zone: "desk", intent: "Taking the finding back to the desk" },
    { id: "security", zone: "review", intent: "Checking the rotation window" },
  ],
  [
    { id: "engineer", zone: "desk", intent: "Fixing the reuse window" },
    { id: "security", zone: "waiting", intent: "Needs a decision on session invalidation", waitingOnYou: true, says: "Revoke every session, or just the reused one?" },
    { id: "tests", zone: "lab", intent: "Re-running the suite" },
  ],
  [
    { id: "tests", zone: "lab", intent: "42 of 42 passing" },
    { id: "review", zone: "shipped", intent: "Approved and integrated", says: "Clean. Shipped." },
    { id: "engineer", zone: "desk", intent: "Idle" },
  ],
];

function blankPresence(id: AgentId): Presence {
  return { id, zone: "desk", intent: "Idle", says: null, toward: null, blocked: false, waitingOnYou: false };
}

export function Office({
  members,
  live,
  livePresence,
  onOpenAgent,
  onClose,
}: {
  members: readonly AgentTeamMember[];
  /** True when a session is running and presence reflects real events. */
  live: boolean;
  livePresence: ReadonlyMap<AgentId, Presence>;
  onOpenAgent: (id: AgentId) => void;
  onClose: () => void;
}) {
  const [beat, setBeat] = useState(0);
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const [hovered, setHovered] = useState<AgentId | null>(null);
  const timer = useRef<number | null>(null);

  // Scrubbing pins the floor to a past beat. Being able to wind the shift back
  // is the difference between watching a room and being able to ask what
  // happened while you were away.
  const shown = scrubbed ?? beat;

  // The demo only advances when nothing real is running, so a live floor is
  // never overwritten by a script.
  useEffect(() => {
    if (live || scrubbed !== null) return;
    timer.current = window.setInterval(() => setBeat((current) => current + 1), 3400);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [live, scrubbed]);

  const presence = useMemo(() => {
    const base = new Map<AgentId, Presence>(members.map((member) => [member.id, blankPresence(member.id)]));
    if (live) {
      for (const [id, value] of livePresence) if (base.has(id)) base.set(id, value);
      return base;
    }
    // Beats are cumulative: an agent keeps its last state until something
    // changes it, which is what makes the floor read as continuous.
    for (let index = 0; index <= shown % DEMO.length; index += 1) {
      for (const change of DEMO[index]) {
        const current = base.get(change.id);
        if (!current) continue;
        base.set(change.id, { ...current, says: null, toward: null, ...change });
      }
    }
    return base;
  }, [shown, live, livePresence, members]);

  const waiting = members.filter((member) => presence.get(member.id)?.waitingOnYou);

  return (
    <div className="officeSheet" role="dialog" aria-modal="true" aria-label="The Office">
      <header className="officeBar">
        <h2>The Office</h2>
        <p className="officeMode" data-live={live}>
          {live ? "live · driven by this session" : "demonstration · no session running"}
        </p>
        <button type="button" className="buttonQuiet" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="officeBody">
        <div className="floorWrap">
          <div className="floor">
            {ZONES.map((zone) => {
              const here = members.filter((member) => presence.get(member.id)?.zone === zone.id).length;
              return (
                <div
                  key={zone.id}
                  className="zone"
                  data-zone={zone.id}
                  data-active={zone.id === "waiting" && waiting.length > 0}
                  style={{ left: `${zone.left}%`, top: `${zone.top}%`, width: `${zone.width}%`, height: `${zone.height}%` }}
                >
                  <span>
                    {zone.label}
                    {here > 0 ? ` · ${here}` : ""}
                  </span>
                </div>
              );
            })}

            {/* Furniture sits at the same coordinates the figures stand at, so
                a desk is always under whoever is working at it. */}
            {[24, 24, 40, 40, 24, 40].map((left, index) => (
              <span
                key={`desk-${index}`}
                className="desk"
                style={{ left: `${left}%`, top: `${20 + Math.floor(index / 2) * 24}%` }}
              >
                <span className="deskTop" />
                <span className="deskScreen" />
              </span>
            ))}
            <span className="bench" style={{ left: "64%", top: "30%" }} />
            <span className="bench" style={{ left: "64%", top: "70%" }} />
            <span className="couch" style={{ left: "86%", top: "30%" }} />
            <span className="plant" style={{ left: "9%", top: "80%" }} />
            <span className="plant" style={{ left: "86%", top: "78%" }} />

            {members.map((member) => {
              const state = presence.get(member.id) ?? blankPresence(member.id);
              const occupants = members
                .filter((other) => (presence.get(other.id) ?? blankPresence(other.id)).zone === state.zone)
                .map((other) => other.id);
              const seat = seatOf(state, occupants);
              const definition = agent(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  className="person"
                  style={{ left: `${seat.left}%`, top: `${seat.top}%` }}
                  data-zone={state.zone}
                  data-waiting={state.waitingOnYou}
                  data-talking={Boolean(state.says)}
                  onMouseEnter={() => setHovered(member.id)}
                  onMouseLeave={() => setHovered((current) => (current === member.id ? null : current))}
                  onFocus={() => setHovered(member.id)}
                  onBlur={() => setHovered((current) => (current === member.id ? null : current))}
                  onClick={() => onOpenAgent(member.id)}
                  aria-label={`${definition.name}, ${definition.role}. ${state.intent}`}
                >
                  {state.says ? <span className="bubble">{state.says}</span> : null}
                  <span className="figure" data-tone={definition.tone}>
                    <span className="figureHead" />
                    <span className="figureTorso">{definition.monogram}</span>
                    <span className="figureLegs">
                      <i />
                      <i />
                    </span>
                    <span className="figureShadow" />
                  </span>
                  <span className="personName">{definition.name}</span>
                  {hovered === member.id ? <span className="intent">{state.intent}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="scrubber">
          <button
            type="button"
            className="scrubLive"
            data-live={scrubbed === null}
            onClick={() => setScrubbed(null)}
            disabled={scrubbed === null}
          >
            {scrubbed === null ? "Following" : "Back to now"}
          </button>
          <label className="scrubTrack">
            <span className="srOnly">Wind the shift back</span>
            <input
              type="range"
              min={0}
              max={DEMO.length - 1}
              value={shown % DEMO.length}
              onChange={(event) => setScrubbed(Number(event.target.value))}
            />
          </label>
          <span className="scrubStamp">
            {scrubbed === null ? "now" : `${DEMO.length - 1 - (shown % DEMO.length)} steps back`}
          </span>
        </div>

        <aside className="officeSide">
          <p className="officeSideHead">
            Waiting on you <span className="officeCount">{waiting.length}</span>
          </p>
          {waiting.length === 0 ? (
            <p className="panelEmpty">Nobody is blocked on a decision from you.</p>
          ) : (
            <ul className="waitList">
              {waiting.map((member) => {
                const state = presence.get(member.id) as Presence;
                return (
                  <li key={member.id}>
                    <button type="button" className="waitRow" onClick={() => onOpenAgent(member.id)}>
                      <span className="personAvatar avatar-sm" data-tone={agent(member.id).tone}>
                        {agent(member.id).monogram}
                      </span>
                      <span className="waitText">
                        <span className="waitName">{agent(member.id).name}</span>
                        <span className="waitAsk">{state.says ?? state.intent}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="officeSideHead">Floor</p>
          <ul className="floorList">
            {members.map((member) => {
              const state = presence.get(member.id) ?? blankPresence(member.id);
              return (
                <li key={member.id}>
                  <button type="button" className="floorRow" onClick={() => onOpenAgent(member.id)}>
                    <span className="dot" data-zone={state.zone} data-waiting={state.waitingOnYou} />
                    <span className="floorName">{agent(member.id).name}</span>
                    <span className="floorIntent">{state.intent}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
