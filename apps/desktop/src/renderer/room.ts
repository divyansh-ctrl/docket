/**
 * The room's state: channels, what was said in them, and the tickets raised.
 *
 * One rule governs everything here. A message is only ever produced from
 * something that actually happened -- an agent was selected and the signal that
 * selected it, a model was changed, a file was written, a person typed. There
 * is no invented chatter. The previous version of this app filled the screen
 * with fabricated activity, which looks impressive and tells the user nothing
 * they can act on.
 */
import { type AgentId, agent } from "../shared/agent-roster";
import type { AgentTeam, AgentTeamMember } from "../shared/ipc-contract";

export type Speaker = AgentId | "you" | "room";

export type MessageKind = "say" | "join" | "ticket" | "note";

export type Message = Readonly<{
  id: string;
  channelId: string;
  author: Speaker;
  body: string;
  at: number;
  kind: MessageKind;
  /** Agents addressed in the body, rendered as chips. */
  mentions: readonly AgentId[];
  /** Concrete paths or packages backing the claim. */
  evidence: readonly string[];
  ticketId?: string;
}>;

export type TicketState = "open" | "blocked" | "resolved";

export type Ticket = Readonly<{
  id: string;
  title: string;
  body: string;
  raisedBy: Speaker;
  owner: AgentId | null;
  state: TicketState;
  at: number;
  evidence: readonly string[];
}>;

export type Channel = Readonly<{
  id: string;
  name: string;
  purpose: string;
}>;

export type Room = Readonly<{
  channels: readonly Channel[];
  messages: readonly Message[];
  tickets: readonly Ticket[];
}>;

export const CHANNELS: readonly Channel[] = Object.freeze([
  { id: "floor", name: "floor", purpose: "Everything the team does, in order" },
  { id: "tickets", name: "tickets", purpose: "Blocked, ambiguous, or out of scope" },
  { id: "roster", name: "roster", purpose: "Who is here and why" },
]);

export const EMPTY_ROOM: Room = Object.freeze({
  channels: CHANNELS,
  messages: Object.freeze([]),
  tickets: Object.freeze([]),
});

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

const MENTION = /@([a-z][a-z-]*)/g;

/** Finds @mentions that name a real agent, so a chip is never a dead link. */
export function findMentions(body: string, present: readonly AgentId[]): readonly AgentId[] {
  const here = new Set<string>(present);
  const found = new Set<AgentId>();
  for (const match of body.matchAll(MENTION)) {
    if (here.has(match[1])) found.add(match[1] as AgentId);
  }
  return [...found];
}

export function say(
  room: Room,
  channelId: string,
  author: Speaker,
  body: string,
  extra: Partial<Pick<Message, "kind" | "evidence" | "ticketId">> = {},
): Room {
  const present = room.messages.length > 0 ? presentAgents(room) : [];
  const message: Message = Object.freeze({
    id: nextId("m"),
    channelId,
    author,
    body,
    at: Date.now(),
    kind: extra.kind ?? "say",
    mentions: findMentions(body, present),
    evidence: Object.freeze(extra.evidence ?? []),
    ticketId: extra.ticketId,
  });
  return { ...room, messages: Object.freeze([...room.messages, message]) };
}

function presentAgents(room: Room): readonly AgentId[] {
  const ids = new Set<AgentId>();
  for (const message of room.messages) {
    if (message.author !== "you" && message.author !== "room") ids.add(message.author);
  }
  return [...ids];
}

/**
 * Seeds the room from a detected team. Every line here restates a fact the
 * detector produced: which agent, why, and on which model.
 */
export function seedRoom(team: AgentTeam, workspaceName: string): Room {
  let room: Room = { channels: CHANNELS, messages: [], tickets: [] };

  room = say(
    room,
    "roster",
    "room",
    `Opened ${workspaceName}. Read the repository and put ${team.members.length} agents on the team.`,
    { kind: "note" },
  );

  for (const member of team.members) {
    const definition = agent(member.id);
    room = say(room, "roster", member.id, `${member.reason}. I own: ${definition.role.toLowerCase()}.`, {
      kind: "join",
      evidence: member.evidence,
    });
  }

  if (team.written.length > 0) {
    room = say(
      room,
      "roster",
      "room",
      `Wrote ${team.written.length} role ${team.written.length === 1 ? "file" : "files"} into the repository. The agents read these, so editing them changes how the team behaves.`,
      { kind: "note", evidence: team.written },
    );
  }
  if (team.skipped.length > 0) {
    room = say(
      room,
      "roster",
      "room",
      `Left ${team.skipped.length} ${team.skipped.length === 1 ? "file" : "files"} alone: you wrote ${team.skipped.length === 1 ? "it" : "them"}, so ${team.skipped.length === 1 ? "it is" : "they are"} yours.`,
      { kind: "note", evidence: team.skipped },
    );
  }

  const lead = team.members.find((member) => member.id === "lead");
  if (lead) {
    room = say(
      room,
      "floor",
      "lead",
      `The team is on. Give me a request and I will split it into units and assign each one. I do not write code, so nothing changes in ${workspaceName} until you approve it.`,
    );
  }

  return room;
}

export function raiseTicket(
  room: Room,
  input: Readonly<{
    title: string;
    body: string;
    raisedBy: Speaker;
    owner: AgentId | null;
    evidence?: readonly string[];
  }>,
): Room {
  const ticket: Ticket = Object.freeze({
    id: `DOC-${room.tickets.length + 1}`,
    title: input.title,
    body: input.body,
    raisedBy: input.raisedBy,
    owner: input.owner,
    state: "open",
    at: Date.now(),
    evidence: Object.freeze(input.evidence ?? []),
  });

  const withTicket: Room = { ...room, tickets: Object.freeze([...room.tickets, ticket]) };
  return say(
    withTicket,
    "tickets",
    input.raisedBy,
    input.owner ? `${ticket.title} — @${agent(input.owner).handle}` : ticket.title,
    { kind: "ticket", ticketId: ticket.id, evidence: ticket.evidence },
  );
}

export function setTicketState(room: Room, ticketId: string, state: TicketState): Room {
  return {
    ...room,
    tickets: Object.freeze(
      room.tickets.map((ticket) => (ticket.id === ticketId ? { ...ticket, state } : ticket)),
    ),
  };
}

export function messagesIn(room: Room, channelId: string): readonly Message[] {
  return room.messages.filter((message) => message.channelId === channelId);
}

export function unresolvedCount(room: Room): number {
  return room.tickets.filter((ticket) => ticket.state !== "resolved").length;
}

/** Display name for any speaker, including the two that are not agents. */
export function speakerName(speaker: Speaker): string {
  if (speaker === "you") return "You";
  if (speaker === "room") return "Docket";
  return agent(speaker).name;
}

export function speakerMonogram(speaker: Speaker): string {
  if (speaker === "you") return "YOU";
  if (speaker === "room") return "DK";
  return agent(speaker).monogram;
}

export function speakerTone(speaker: Speaker): string {
  if (speaker === "you") return "you";
  if (speaker === "room") return "room";
  return agent(speaker).tone;
}

export function modelOf(members: readonly AgentTeamMember[], speaker: Speaker): string | null {
  if (speaker === "you" || speaker === "room") return null;
  return members.find((member) => member.id === speaker)?.model ?? null;
}
