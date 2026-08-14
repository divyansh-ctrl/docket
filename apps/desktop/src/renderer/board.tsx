/**
 * The ticket board.
 *
 * Columns are the three states a ticket can be in, deliberately not the six
 * zones the Office floor is laid out in: the floor shows where the agents are,
 * the board shows what is waiting on a person. Dragging a ticket between
 * columns is the assignment, not a record of one made elsewhere.
 *
 * A ticket carries the thing that makes it actionable -- the file, the failing
 * input, the agent that raised it. A board of one-line titles is a to-do list;
 * what makes this worth opening is that a finding arrives with its evidence
 * attached.
 */
import { useState, type DragEvent, type FormEvent } from "react";
import { agent, type AgentId } from "../shared/agent-roster";
import type { Ticket, TicketState } from "./room";
import { speakerName } from "./room";

export const COLUMNS: ReadonlyArray<Readonly<{ id: TicketState; label: string; hint: string }>> =
  Object.freeze([
    { id: "open", label: "Open", hint: "Raised, nobody on it yet" },
    { id: "blocked", label: "Blocked", hint: "Needs a decision from you" },
    { id: "resolved", label: "Resolved", hint: "Proven closed" },
  ]);

function Chip({ children, tone }: { children: string; tone?: string }) {
  return (
    <span className="cardChip" data-tone={tone}>
      {children}
    </span>
  );
}

function Card({
  ticket,
  onOpen,
  onDragStart,
}: {
  ticket: Ticket;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
}) {
  const owner = ticket.owner ? agent(ticket.owner) : null;
  return (
    <li>
      <article
        className="card"
        draggable
        onDragStart={onDragStart}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        tabIndex={0}
        role="button"
        aria-label={`${ticket.id}: ${ticket.title}`}
      >
        <p className="cardHead">
          <span className="cardId">{ticket.id}</span>
          {owner ? (
            <span className="cardOwner">
              <span className="cardAvatar" data-tone={owner.tone}>
                {owner.monogram}
              </span>
              {owner.name}
            </span>
          ) : (
            <span className="cardOwner cardUnassigned">Unassigned</span>
          )}
        </p>
        <p className="cardTitle">{ticket.title}</p>
        {ticket.evidence.length > 0 ? (
          <ul className="cardEvidence">
            {ticket.evidence.slice(0, 2).map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="cardFoot">
          <Chip tone={ticket.state}>{ticket.state}</Chip>
          <span className="cardRaised">raised by {speakerName(ticket.raisedBy)}</span>
        </p>
      </article>
    </li>
  );
}

export function Board({
  tickets,
  onMove,
  onOpen,
  onRaise,
}: {
  tickets: readonly Ticket[];
  onMove: (ticketId: string, state: TicketState) => void;
  onOpen: (ticketId: string) => void;
  onRaise: (title: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TicketState | null>(null);
  const [draft, setDraft] = useState("");

  // The board replaced a channel that had a composer, so it has to carry one:
  // a board you can only sort and never add to is a worse tool than the list
  // it replaced.
  function raise(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (title.length === 0) return;
    onRaise(title);
    setDraft("");
  }

  // The dragged id is read back out of the dataTransfer rather than from
  // state. State is a render behind: a drop that lands in the same tick as the
  // dragstart sees the previous value and silently does nothing.
  function drop(event: DragEvent<HTMLElement>, state: TicketState) {
    const id = event.dataTransfer.getData("text/plain") || dragging;
    if (id) onMove(id, state);
    setDragging(null);
    setOver(null);
  }

  return (
    <section className="board" aria-label="Tickets">
      {COLUMNS.map((column) => {
        const inColumn = tickets.filter((ticket) => ticket.state === column.id);
        return (
          <div
            key={column.id}
            className="column"
            data-over={over === column.id}
            onDragOver={(event) => {
              // Without preventDefault the drop never fires and the card
              // silently snaps back, which reads as the board being broken.
              event.preventDefault();
              setOver(column.id);
            }}
            onDragLeave={() => setOver((current) => (current === column.id ? null : current))}
            onDrop={(event) => drop(event, column.id)}
          >
            <header className="columnHead">
              <h3>
                {column.label} <span className="columnCount">{inColumn.length}</span>
              </h3>
              <p>{column.hint}</p>
            </header>

            {column.id === "open" ? (
              <form className="newTicket" onSubmit={raise}>
                <label className="srOnly" htmlFor="newTicket">
                  Raise a ticket
                </label>
                <input
                  id="newTicket"
                  value={draft}
                  placeholder="Raise a ticket — name an agent with @"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" disabled={draft.trim().length === 0}>
                  Add
                </button>
              </form>
            ) : null}

            {inColumn.length === 0 ? (
              <p className="columnEmpty">Nothing here.</p>
            ) : (
              <ul className="cardList">
                {inColumn.map((ticket) => (
                  <Card
                    key={ticket.id}
                    ticket={ticket}
                    onOpen={() => onOpen(ticket.id)}
                    onDragStart={(event) => {
                      setDragging(ticket.id);
                      event.dataTransfer.effectAllowed = "move";
                      // Some platforms refuse to start a drag without payload.
                      event.dataTransfer.setData("text/plain", ticket.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function TicketDetail({
  ticket,
  onClose,
  onAssign,
  onMove,
}: {
  ticket: Ticket;
  onClose: () => void;
  onAssign: (agentId: AgentId) => void;
  onMove: (state: TicketState) => void;
}) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={ticket.id}>
      <div className="sheetInner sheetNarrow">
        <header className="sheetHead">
          <div>
            <h2>
              {ticket.id} <Chip tone={ticket.state}>{ticket.state}</Chip>
            </h2>
            <p>{ticket.title}</p>
          </div>
          <button type="button" className="buttonQuiet" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="ticketDetailBody">{ticket.body}</p>

        {ticket.evidence.length > 0 ? (
          <>
            <p className="officeSideHead">Evidence</p>
            <ul className="evidence">
              {ticket.evidence.map((item) => (
                <li key={item}>
                  <code>{item}</code>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="officeSideHead">Owner</p>
        <div className="assignRow">
          {["engineer", "review", "tests", "security", "interface", "data", "release", "docs"].map((id) => (
            <button
              key={id}
              type="button"
              className="assignChip"
              data-current={ticket.owner === id}
              onClick={() => onAssign(id as AgentId)}
            >
              <span className="cardAvatar" data-tone={agent(id as AgentId).tone}>
                {agent(id as AgentId).monogram}
              </span>
              {agent(id as AgentId).name}
            </button>
          ))}
        </div>

        <p className="officeSideHead">Move to</p>
        <div className="assignRow">
          {COLUMNS.map((column) => (
            <button
              key={column.id}
              type="button"
              className="assignChip"
              data-current={ticket.state === column.id}
              onClick={() => onMove(column.id)}
            >
              {column.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
