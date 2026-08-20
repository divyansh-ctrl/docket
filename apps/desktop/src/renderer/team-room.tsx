import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { agent, type AgentId } from "../shared/agent-roster";
import type { AgentActivity, AgentTeamMember } from "../shared/ipc-contract";
import { describeChoice } from "../shared/agent-model";
import { TabBar } from "./tab-bar";
import type { TabId } from "./tabs";
import {
  type Channel,
  type Message,
  type Room,
  type Speaker,
  type Ticket,
  messagesIn,
  modelOf,
  speakerMonogram,
  speakerName,
  speakerTone,
  unresolvedCount,
} from "./room";

function initials(speaker: Speaker) {
  return speakerMonogram(speaker);
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function Avatar({ speaker, size = "md" }: { speaker: Speaker; size?: "sm" | "md" }) {
  return (
    <span className={`avatar avatar-${size}`} data-tone={speakerTone(speaker)} aria-hidden="true">
      {initials(speaker)}
    </span>
  );
}

/** Renders @mentions as chips so a handoff is visible at a glance. */
function Body({ body, mentions }: { body: string; mentions: readonly AgentId[] }) {
  if (mentions.length === 0) return <p className="messageBody">{body}</p>;

  const pattern = new RegExp(`@(${mentions.map((id) => agent(id).handle).join("|")})\\b`, "g");
  const parts: Array<string | { handle: string }> = [];
  let index = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index > index) parts.push(body.slice(index, match.index));
    parts.push({ handle: match[1] });
    index = match.index + match[0].length;
  }
  if (index < body.length) parts.push(body.slice(index));

  return (
    <p className="messageBody">
      {parts.map((part, position) =>
        typeof part === "string" ? (
          <span key={position}>{part}</span>
        ) : (
          <span key={position} className="mention">
            @{part.handle}
          </span>
        ),
      )}
    </p>
  );
}

function Evidence({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="evidence">
      {items.map((item) => (
        <li key={item}>
          <code>{item}</code>
        </li>
      ))}
    </ul>
  );
}

function MessageRow({
  message,
  members,
  onOpenTicket,
}: {
  message: Message;
  members: readonly AgentTeamMember[];
  onOpenTicket: (ticketId: string) => void;
}) {
  const model = modelOf(members, message.author);
  return (
    <li className="message" data-kind={message.kind}>
      <Avatar speaker={message.author} />
      <div className="messageMain">
        <p className="messageHead">
          <span className="messageAuthor">{speakerName(message.author)}</span>
          {/* The model is shown on every line on purpose: who did the work is
              never hidden behind a persona. */}
          {model ? <span className="messageModel">{model}</span> : null}
          <time className="messageTime">{clock(message.at)}</time>
        </p>
        <Body body={message.body} mentions={message.mentions} />
        <Evidence items={message.evidence} />
        {message.ticketId ? (
          <button type="button" className="ticketLink" onClick={() => onOpenTicket(message.ticketId as string)}>
            {message.ticketId}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function ChannelRail({
  channels,
  activeId,
  room,
  members,
  onSelect,
  onOpenAgent,
  tab,
  workspaceOpen,
  onSelectTab,
}: {
  channels: readonly Channel[];
  activeId: string;
  room: Room;
  members: readonly AgentTeamMember[];
  onSelect: (id: string) => void;
  onOpenAgent: (id: AgentId) => void;
  tab: TabId;
  workspaceOpen: boolean;
  onSelectTab: (tab: TabId) => void;
}) {
  const open = unresolvedCount(room);
  return (
    <nav className="rail" aria-label="Views, channels and team">
      <p className="railHeading" id="rail-views">
        Views
      </p>
      <TabBar active={tab} workspaceOpen={workspaceOpen} onSelect={onSelectTab} />

      <p className="railHeading">Channels</p>
      <ul className="channelList">
        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              className="channelButton"
              aria-current={channel.id === activeId ? "true" : undefined}
              onClick={() => onSelect(channel.id)}
            >
              <span className="channelHash">#</span>
              <span className="channelName">{channel.name}</span>
              {channel.id === "tickets" && open > 0 ? <span className="channelCount">{open}</span> : null}
            </button>
          </li>
        ))}
      </ul>

      <p className="railHeading">
        Team <span className="railCount">{members.length}</span>
      </p>
      <ul className="teamList">
        {members.map((member) => {
          const definition = agent(member.id);
          return (
            <li key={member.id}>
              <button type="button" className="teamButton" onClick={() => onOpenAgent(member.id)}>
                <Avatar speaker={member.id} size="sm" />
                <span className="teamText">
                  <span className="teamName">{definition.name}</span>
                  <span className="teamRole">{describeChoice(member.model)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Stream({
  channel,
  room,
  members,
  onSend,
  onOpenTicket,
  disabled,
}: {
  channel: Channel;
  room: Room;
  members: readonly AgentTeamMember[];
  onSend: (body: string) => void;
  onOpenTicket: (ticketId: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const messages = useMemo(() => messagesIn(room, channel.id), [room, channel.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, channel.id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (body.length === 0) return;
    onSend(body);
    setDraft("");
  }

  return (
    <section className="stream" aria-label={`#${channel.name}`}>
      <header className="streamHead">
        <h2>
          <span className="channelHash">#</span>
          {channel.name}
        </h2>
        <p>{channel.purpose}</p>
      </header>

      {messages.length === 0 ? (
        <p className="streamEmpty">Nothing here yet.</p>
      ) : (
        <ul className="messages">
          {messages.map((message) => (
            <MessageRow key={message.id} message={message} members={members} onOpenTicket={onOpenTicket} />
          ))}
        </ul>
      )}
      <div ref={endRef} />

      <form className="composer" onSubmit={submit}>
        <label className="srOnly" htmlFor="composer">
          Message #{channel.name}
        </label>
        <input
          id="composer"
          value={draft}
          disabled={disabled}
          placeholder={disabled ? "Open a repository to start" : `Message #${channel.name}`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={disabled || draft.trim().length === 0}>
          Send
        </button>
      </form>
    </section>
  );
}

export function TicketPanel({
  tickets,
  selectedId,
  onSelect,
  onResolve,
}: {
  tickets: readonly Ticket[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onResolve: (id: string) => void;
}) {
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;

  if (!selected) {
    return (
      <aside className="panel" aria-label="Tickets">
        <h2 className="panelHead">Tickets</h2>
        {tickets.length === 0 ? (
          <p className="panelEmpty">
            No tickets. Agents raise one when a unit is blocked, ambiguous, or bigger than its brief.
          </p>
        ) : (
          <ul className="ticketList">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button type="button" className="ticketRow" onClick={() => onSelect(ticket.id)}>
                  <span className="ticketId">{ticket.id}</span>
                  <span className="ticketTitle">{ticket.title}</span>
                  <span className="ticketState" data-state={ticket.state}>
                    {ticket.state}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    );
  }

  return (
    <aside className="panel" aria-label={`Ticket ${selected.id}`}>
      <button type="button" className="panelBack" onClick={() => onSelect(null)}>
        ← All tickets
      </button>
      <h2 className="panelHead">
        {selected.id} <span className="ticketState" data-state={selected.state}>{selected.state}</span>
      </h2>
      <p className="ticketDetailTitle">{selected.title}</p>
      <p className="ticketDetailBody">{selected.body}</p>

      <dl className="ticketMeta">
        <dt>Raised by</dt>
        <dd>{speakerName(selected.raisedBy)}</dd>
        <dt>Owner</dt>
        <dd>{selected.owner ? agent(selected.owner).name : "Unassigned"}</dd>
      </dl>

      <Evidence items={selected.evidence} />

      {selected.state !== "resolved" ? (
        <button type="button" className="buttonSolid" onClick={() => onResolve(selected.id)}>
          Mark resolved
        </button>
      ) : null}
    </aside>
  );
}

/**
 * An agent's session: what it is doing now and what it has actually done.
 *
 * The run log is built only from lifecycle events the CLI reported, so an
 * empty panel means the agent genuinely has not run rather than that Docket
 * failed to notice. That distinction is worth the blank space.
 */
export function AgentPanel({
  agentId,
  members,
  activity,
  presence,
  onClose,
}: {
  agentId: AgentId;
  members: readonly AgentTeamMember[];
  activity: readonly AgentActivity[];
  presence: { intent: string; zone: string } | null;
  onClose: () => void;
}) {
  const definition = agent(agentId);
  const member = members.find((entry) => entry.id === agentId);
  const runs = [...activity].reverse();
  const working = activity.length > 0 && activity[activity.length - 1].kind === "start";

  return (
    <aside className="panel" aria-label={`${definition.name} session`}>
      <button type="button" className="panelBack" onClick={onClose}>
        ← Close
      </button>

      <div className="agentHead">
        <Avatar speaker={agentId} />
        <div>
          <h2 className="panelHead">{definition.name}</h2>
          <p className="agentRole">{definition.role}</p>
        </div>
      </div>

      <p className="sessionState" data-working={working}>
        {working ? "Working" : "Idle"}
        {presence ? ` · ${presence.intent}` : ""}
      </p>

      <dl className="ticketMeta">
        <dt>Model</dt>
        <dd>{describeChoice(member?.model ?? definition.defaultModel)}</dd>
        <dt>On the team because</dt>
        <dd>{member?.reason ?? "Not on this team"}</dd>
        <dt>Tools</dt>
        <dd>{definition.tools.join(", ")}</dd>
      </dl>

      <Evidence items={member?.evidence ?? []} />

      <p className="officeSideHead">Run log</p>
      {runs.length === 0 ? (
        <p className="panelEmpty">
          This agent has not run yet. Activity appears here as the CLI reports it, so nothing is
          shown that did not happen.
        </p>
      ) : (
        <ol className="runLog">
          {runs.map((event) => (
            <li key={`${event.runId}-${event.kind}-${event.at}`} data-kind={event.kind}>
              <span className="runKind">{event.kind === "start" ? "picked up" : "reported"}</span>
              <span className="runBody">{event.summary ?? "started a unit"}</span>
              <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </li>
          ))}
        </ol>
      )}

      <p className="panelNote">
        Charter lives at <code>.claude/agents/{definition.handle}.md</code>. The agent reads it, so
        editing it changes behaviour.
      </p>
    </aside>
  );
}
