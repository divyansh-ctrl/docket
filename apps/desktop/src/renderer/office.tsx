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

export type Presence = Readonly<{
  id: AgentId;
  /** Where the agent is, which is a statement about its state. */
  zone: "desk" | "meeting" | "waiting" | "away";
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

// Coordinates are percentages of the floor before it is tilted, and they sit
// inside the zone rectangles below on purpose: an agent standing outside the
// desk pool while described as working would undo the whole point of using
// position to mean something.
const DESKS: ReadonlyArray<readonly [number, number]> = [
  [26, 50],
  [42, 50],
  [58, 50],
  [74, 50],
  [26, 68],
  [42, 68],
  [58, 68],
  [74, 68],
  [84, 59],
];
const MEETING: readonly [number, number] = [29, 22];
const WAITING: readonly [number, number] = [47, 82];

function seatOf(index: number, presence: Presence): { left: number; top: number } {
  if (presence.zone === "meeting") {
    // Two agents in a handoff stand either side of the table rather than on
    // top of each other.
    const offset = index % 2 === 0 ? -6 : 6;
    return { left: MEETING[0] + offset, top: MEETING[1] + (index % 2) * 5 };
  }
  if (presence.zone === "waiting") {
    return { left: WAITING[0] + (index % 3) * 11 - 11, top: WAITING[1] };
  }
  const [left, top] = DESKS[index % DESKS.length];
  return { left, top };
}

/**
 * The scripted loop shown before any real session has run. Written as beats so
 * it reads like a shift rather than a random walk: work, a handoff, a finding,
 * a block that needs a person.
 */
const DEMO: ReadonlyArray<ReadonlyArray<Partial<Presence> & { id: AgentId }>> = [
  [
    { id: "lead", zone: "desk", intent: "Splitting the request into units", says: "Three units. Starting with the token store." },
    { id: "engineer", zone: "desk", intent: "Reading src/auth before touching it" },
    { id: "review", zone: "desk", intent: "Idle — nothing to review yet" },
    { id: "tests", zone: "desk", intent: "Idle" },
  ],
  [
    { id: "lead", zone: "meeting", intent: "Handing the unit to Vega", says: "@engineer single-use refresh, one file.", toward: "engineer" },
    { id: "engineer", zone: "meeting", intent: "Taking the brief", says: "Got it. Rotation only." },
  ],
  [
    { id: "engineer", zone: "desk", intent: "Writing the reuse guard in refresh.ts" },
    { id: "tests", zone: "desk", intent: "Writing the concurrent-refresh case", says: "Two requests, one token." },
  ],
  [
    { id: "engineer", zone: "desk", intent: "4 files changed, handing off" },
    { id: "review", zone: "desk", intent: "Reading the diff", says: "Reading 4 files." },
    { id: "tests", zone: "desk", intent: "41 of 42 passing" },
  ],
  [
    { id: "review", zone: "meeting", intent: "Raising a finding with Vega", says: "Concurrent refresh still reuses. DOC-4.", toward: "engineer" },
    { id: "engineer", zone: "meeting", intent: "Taking the finding" },
    { id: "security", zone: "desk", intent: "Checking the rotation window" },
  ],
  [
    { id: "engineer", zone: "desk", intent: "Fixing the reuse window" },
    { id: "security", zone: "waiting", intent: "Needs a decision on session invalidation", waitingOnYou: true, says: "Revoke every session, or just the reused one?" },
  ],
  [
    { id: "tests", zone: "desk", intent: "42 of 42 passing" },
    { id: "engineer", zone: "desk", intent: "Idle — waiting on review" },
    { id: "review", zone: "desk", intent: "Re-reading the fix" },
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
  const [hovered, setHovered] = useState<AgentId | null>(null);
  const timer = useRef<number | null>(null);

  // The demo only advances when nothing real is running, so a live floor is
  // never overwritten by a script.
  useEffect(() => {
    if (live) return;
    timer.current = window.setInterval(() => setBeat((current) => current + 1), 3400);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [live]);

  const presence = useMemo(() => {
    const base = new Map<AgentId, Presence>(members.map((member) => [member.id, blankPresence(member.id)]));
    if (live) {
      for (const [id, value] of livePresence) if (base.has(id)) base.set(id, value);
      return base;
    }
    // Beats are cumulative: an agent keeps its last state until something
    // changes it, which is what makes the floor read as continuous.
    for (let index = 0; index <= beat % DEMO.length; index += 1) {
      for (const change of DEMO[index]) {
        const current = base.get(change.id);
        if (!current) continue;
        base.set(change.id, { ...current, says: null, toward: null, ...change });
      }
    }
    return base;
  }, [beat, live, livePresence, members]);

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
            <div className="zone zoneMeeting">
              <span>Meeting room</span>
            </div>
            <div className="zone zoneDesks">
              <span>Desk pool</span>
            </div>
            <div className="zone zoneWaiting" data-active={waiting.length > 0}>
              <span>Waiting on you</span>
            </div>

            {/* Furniture sits at the same coordinates the figures stand at, so
                a desk is always under whoever is working at it. */}
            {DESKS.map(([left, top]) => (
              <span key={`desk-${left}-${top}`} className="desk" style={{ left: `${left}%`, top: `${top + 4}%` }}>
                <span className="deskTop" />
                <span className="deskScreen" />
              </span>
            ))}
            <span className="table" style={{ left: `${MEETING[0]}%`, top: `${MEETING[1] + 6}%` }} />
            <span className="couch" style={{ left: `${WAITING[0]}%`, top: `${WAITING[1] + 5}%` }} />
            <span className="plant" style={{ left: "12%", top: "88%" }} />
            <span className="plant" style={{ left: "90%", top: "34%" }} />

            {members.map((member, index) => {
              const state = presence.get(member.id) ?? blankPresence(member.id);
              const seat = seatOf(index, state);
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
