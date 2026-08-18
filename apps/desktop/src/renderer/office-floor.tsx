/**
 * The Office as a place you work, rather than a panel you peek at.
 *
 * Three regions, and the split is the argument. The **floor** says where the
 * work is: an agent's zone is its state, so a queue piling up at review while
 * the test lab sits empty is visible before a word is read. The **rail** says
 * who exists and what each one costs to run. The **desk** is where you talk to
 * one of them.
 *
 * What this view refuses to do is invent. Every bubble on the floor is
 * something an agent actually said, every status comes from a recorded event,
 * and the context meter reads "not measured" rather than showing a number
 * nobody counted. A room that fills its own silence with plausible chatter is
 * the exact failure this product exists to remove, and it is more tempting here
 * than anywhere else in the app, because an empty office looks broken and a
 * busy one looks alive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentId, AgentModel } from "../shared/agent-roster";
import { agent, AGENT_MODEL_LABELS } from "../shared/agent-roster";
import type { AgentTeamMember } from "../shared/ipc-contract";
import type { Message } from "./room";
import type { Presence, Zone } from "./office";
import { ZONES } from "./office";
import { describeFloor, statusOf, tallyZones } from "./office-shell";
import { OfficeFloor as OfficeScene, webglAvailable } from "./office-3d";

/** What a card and a desk both need to know about one agent. */
export type FloorAgent = Readonly<{
  id: AgentId;
  presence: Presence;
  /** From the config store, so the card shows what the charter file says. */
  model: AgentModel;
}>;

export type OfficeTab = "terminal" | "git" | "messages";

const TABS: ReadonlyArray<Readonly<{ id: OfficeTab; label: string }>> = Object.freeze([
  { id: "terminal", label: "Terminal" },
  { id: "git", label: "Git" },
  { id: "messages", label: "Messages" },
]);

/**
 * Whether this machine has asked for less motion, kept current.
 *
 * Read live rather than once at mount: the setting can change while the app
 * is open, and a room that keeps walking because it was opened before you
 * turned the preference on is exactly the failure the preference exists to
 * prevent.
 */
function useCalm(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [calm, setCalm] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const listen = () => setCalm(media.matches);
    media.addEventListener("change", listen);
    return () => media.removeEventListener("change", listen);
  }, []);
  return calm;
}

export function OfficeView({
  agents,
  members,
  live,
  dark,
  messages,
  selectedId,
  onSelect,
  onQueue,
  onClose,
}: {
  agents: readonly FloorAgent[];
  /** The 3D floor takes the roster as the app already has it. */
  members: readonly AgentTeamMember[];
  /** False when no session is running, which makes the floor a diagram. */
  live: boolean;
  dark: boolean;
  messages: readonly Message[];
  selectedId: AgentId | null;
  onSelect: (id: AgentId) => void;
  onQueue: (id: AgentId, text: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<OfficeTab>("terminal");
  const [draft, setDraft] = useState("");
  const [hovered, setHovered] = useState<AgentId | null>(null);
  // Falls back to the flat plan rather than showing a black rectangle, which
  // is the rule the scene module already states about itself.
  const [scene, setScene] = useState(() => webglAvailable());
  const [demoTick, setDemoTick] = useState(0);
  const [focus, setFocus] = useState<{ zone: Zone | null; nonce: number }>({ zone: null, nonce: 0 });
  const calm = useCalm();
  const surface = useRef<HTMLDivElement | null>(null);

  // This is a modal dialog and says so in its role, so it owes the two things
  // a modal owes: a way out from the keyboard, and the keyboard inside it.
  // It had neither -- Escape did nothing and focus stayed on whatever opened
  // the office, so the first Tab went into the page behind.
  useEffect(() => {
    surface.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // With no session there are no presence events, so nobody would ever take a
  // step, and a floor built around walking would demonstrate standing still.
  // In demonstration mode -- and only there, under the label that says so --
  // one agent at a time is sent somewhere else every few seconds. Nobody is
  // given words: fake movement under an honest label is a demo, fake speech
  // is a lie about what was said.
  useEffect(() => {
    if (live || calm) return;
    const timer = window.setInterval(() => setDemoTick((tick) => tick + 1), 3200);
    return () => window.clearInterval(timer);
  }, [live, calm]);

  const WANDER: readonly Presence["zone"][] = useMemo(
    () => ["desk", "review", "lab", "desk", "shipped", "intake", "desk", "waiting"],
    [],
  );

  const shown = useMemo(() => {
    if (live || agents.length === 0) return agents;
    return agents.map((entry, index) => ({
      ...entry,
      presence: {
        ...entry.presence,
        // Deterministic per tick: each agent drifts through the pipeline on
        // its own period, so the floor is always mid-story without a single
        // call to Math.random.
        zone: WANDER[(demoTick + index * 3) % WANDER.length] as Presence["zone"],
      },
    }));
  }, [agents, live, demoTick, WANDER]);

  const presence = useMemo(
    () => new Map(shown.map((entry) => [entry.id, entry.presence])),
    [shown],
  );

  const selected = agents.find((entry) => entry.id === selectedId) ?? agents[0] ?? null;

  const seats = useMemo(() => {
    const byZone = new Map<string, FloorAgent[]>();
    for (const entry of shown) {
      const list = byZone.get(entry.presence.zone) ?? [];
      list.push(entry);
      byZone.set(entry.presence.zone, list);
    }
    return byZone;
  }, [shown]);

  const forSelected = useMemo(
    () => (selected ? messages.filter((entry) => entry.author === selected.id) : []),
    [messages, selected],
  );

  const tally = useMemo(() => tallyZones(shown), [shown]);
  const summary = useMemo(() => describeFloor(shown), [shown]);

  // Framing a zone is a camera move, not a state change: it says "show me
  // review", never "put these people in review". The nonce is what lets you
  // press the same zone twice and be taken back to it.
  const frame = useCallback((zone: Zone | null) => {
    setFocus((current) => ({ zone, nonce: current.nonce + 1 }));
  }, []);

  const submit = () => {
    const text = draft.trim();
    if (!text || !selected) return;
    onQueue(selected.id, text);
    setDraft("");
  };

  return (
    <div
      className="floorView"
      role="dialog"
      aria-modal="true"
      aria-label="The Office"
      ref={surface}
      tabIndex={-1}
    >
      <header className="floorBar">
        <p className="floorTitle">The Office</p>
        <p className="floorMode" data-live={live}>
          {live ? "live · driven by this session" : "demonstration · no session is running"}
        </p>
        {/* Said in words as well as drawn, because the count of people
            waiting on you is the one fact here worth reading rather than
            looking at -- and the only one a screen reader can carry. */}
        <p className="floorSummary">{summary}</p>
        <button type="button" className="buttonQuiet" onClick={onClose}>
          Close
        </button>
      </header>

      {/* The pipeline as a strip: every stage, including the empty ones,
          because an empty test lab beside a crowded review bench is the fact
          the floor exists to show. Pressing one takes the camera there. */}
      <nav className="floorStages" aria-label="Stages">
        {tally.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className="floorStage"
            data-empty={zone.count === 0}
            data-needs-you={zone.needsYou}
            data-focused={focus.zone === zone.id}
            onClick={() => frame(zone.id)}
            title={zone.note}
            aria-label={`${zone.label}: ${zone.count} ${zone.count === 1 ? "agent" : "agents"}`}
          >
            <span className="floorStageName">{zone.label}</span>
            <span className="floorStageCount">{zone.count}</span>
          </button>
        ))}
        <button
          type="button"
          className="floorStage floorStageAll"
          data-focused={focus.zone === null && focus.nonce > 0}
          onClick={() => frame(null)}
        >
          Whole floor
        </button>
      </nav>

      <div className="floorBody">
        {scene ? (
          <div className="floorScene">
            <OfficeScene
              members={members}
              presence={presence}
              hovered={hovered}
              dark={dark}
              focus={focus}
              selected={selected?.id ?? null}
              calm={calm}
              onHover={setHovered}
              onOpenAgent={onSelect}
              onUnavailable={() => setScene(false)}
            />
          </div>
        ) : (
        <div className="floorPlan" aria-label="Floor plan">
          {ZONES.map((zone) => {
            const here = seats.get(zone.id) ?? [];
            return (
              <section
                key={zone.id}
                className="floorZone"
                style={{
                  left: `${zone.left}%`,
                  top: `${zone.top}%`,
                  width: `${zone.width}%`,
                  height: `${zone.height}%`,
                }}
              >
                <p className="floorZoneName">
                  {zone.label}
                  <span className="floorZoneCount">{here.length}</span>
                </p>
                <div className="floorDesks">
                  {here.map((entry) => {
                    const definition = agent(entry.id);
                    const status = statusOf(entry.presence);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className="floorDesk"
                        data-status={status.tone}
                        data-selected={entry.id === selected?.id}
                        style={{ ["--tone" as string]: `var(--tone-${definition.tone})` }}
                        onClick={() => onSelect(entry.id)}
                        title={entry.presence.intent || definition.role}
                      >
                        {entry.presence.says ? (
                          <span className="floorBubble">{entry.presence.says}</span>
                        ) : null}
                        <span className="floorPerson" aria-hidden="true">
                          {definition.monogram}
                        </span>
                        <span className="floorName">{definition.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        )}

        <aside className="deskPanel">
          {selected ? (
            <>
              <header className="deskHead">
                <p className="deskName">{agent(selected.id).name}</p>
                <p className="deskRole">{agent(selected.id).role}</p>
                <p className="deskModel" title={AGENT_MODEL_LABELS[selected.model]}>
                  {selected.model}
                </p>
              </header>

              <nav className="deskTabs" role="tablist">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === entry.id}
                    className="deskTab"
                    onClick={() => setTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>

              <div className="deskBody" role="tabpanel">
                {tab === "messages" ? (
                  forSelected.length > 0 ? (
                    <ul className="deskLog">
                      {forSelected.map((entry) => (
                        <li key={entry.id}>
                          <span className="deskLogWhen">{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          {entry.body}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="deskEmpty">
                      {agent(selected.id).name} has not said anything in this session.
                    </p>
                  )
                ) : null}

                {tab === "terminal" ? (
                  <p className="deskEmpty">
                    {live
                      ? "This agent has no terminal of its own yet. Session output is in the terminal surface."
                      : "No session is running, so there is no output to show."}
                  </p>
                ) : null}

                {tab === "git" ? (
                  <p className="deskEmpty">
                    Per-agent Git activity is not recorded yet, so there is nothing here to show.
                  </p>
                ) : null}
              </div>

              {/* The number a reviewer would most like to see, and the one most
                  easily faked. Nothing counts tokens yet, so it says so. */}
              <p className="deskMeter" title="Docket does not measure context use yet">
                ctx <span className="deskMeterValue">not measured</span>
              </p>

              <form
                className="deskQueue"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <label className="deskQueueLabel" htmlFor="deskQueueInput">
                  Queue
                </label>
                <textarea
                  id="deskQueueInput"
                  className="deskQueueInput"
                  rows={2}
                  placeholder={`Message ${agent(selected.id).name}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="deskQueueFoot">
                  <button type="submit" className="buttonSolid" disabled={draft.trim().length === 0}>
                    Send
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="deskEmpty">No agents on this floor yet.</p>
          )}
        </aside>
      </div>

      <div className="railScroll">
        {shown.length === 0 ? (
          <p className="railEmpty">
            No agents yet. Docket writes the team from the repository when you open one.
          </p>
        ) : null}
        <ul className="rail">
          {shown.map((entry) => {
            const definition = agent(entry.id);
            const status = statusOf(entry.presence);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="railCard"
                  data-selected={entry.id === selected?.id}
                  style={{ ["--tone" as string]: `var(--tone-${definition.tone})` }}
                  onClick={() => onSelect(entry.id)}
                >
                  <span className="railFace" aria-hidden="true">
                    {definition.monogram}
                  </span>
                  <span className="railText">
                    <span className="railName">{definition.name}</span>
                    <span className="railMeta">{entry.model}</span>
                  </span>
                  <span className="railStatus" data-tone={status.tone}>
                    {status.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
