/**
 * MCP servers, and an honest account of what each CLI will do with them.
 *
 * The editing is the easy half. The half worth building carefully is the
 * reporting: the two CLIs disagree about which fields exist, and a tab that
 * wrote both files and said "done" would be hiding the fact that a tool
 * denylist reached one of them and not the other.
 *
 * So a row says where a server will run before it is applied, and applying
 * reports three separate things -- what was written, what was carried across
 * differently, and what was not carried at all.
 */
import { useState } from "react";
import type { McpApplyReport, McpServer } from "../shared/ipc-contract";
import type { McpTransport } from "../shared/mcp-config";
import { EMPTY_DRAFT, type Draft, draftToServer, reach, serverToDraft } from "./mcp-draft";
import { Pane } from "./pane";

const TRANSPORTS: readonly { id: McpTransport; label: string; hint: string }[] = Object.freeze([
  { id: "stdio", label: "Local process", hint: "A command Docket's CLI starts and talks to over its input and output." },
  { id: "http", label: "HTTP", hint: "A streamable HTTP endpoint. The only remote transport Codex speaks." },
  { id: "sse", label: "Server-sent events", hint: "Claude Code only." },
  { id: "ws", label: "WebSocket", hint: "Claude Code only." },
]);

export function McpPanel({
  servers,
  busy,
  report,
  onSave,
  onApply,
  onImport,
}: {
  servers: readonly McpServer[];
  busy: boolean;
  report: McpApplyReport | null;
  onSave: (servers: readonly McpServer[]) => void;
  onApply: () => void;
  onImport: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<string | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const reset = (): void => {
    setDraft(EMPTY_DRAFT);
    setEditing(null);
    setProblems([]);
  };

  const submit = (): void => {
    // An edit is allowed to keep its own name, so it is excluded from the
    // duplicate check rather than tripping over itself.
    const taken = servers.map((server) => server.id).filter((id) => id !== editing);
    const result = draftToServer(draft, taken);
    if (!result.server) {
      setProblems(result.problems);
      return;
    }
    const without = servers.filter((server) => server.id !== editing);
    onSave([...without, result.server]);
    reset();
  };

  const remote = draft.transport !== "stdio";

  return (
    <Pane tab="mcp">
        <header className="sheetHead">
          <div>
            <h2>MCP servers</h2>
            <p>
              A server is a set of tools an agent can call. Docket keeps one description of each and writes it
              into both CLIs&rsquo; formats, which do not agree — so each row says where it will actually run.
            </p>
          </div>
        </header>

        <section className="mcpList" aria-label="Configured servers">
          {servers.length === 0 ? (
            <p className="empty">No servers yet. Add one below, or import what this repository already has.</p>
          ) : (
            <ul>
              {[...servers]
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((server) => {
                  const where = reach(server);
                  return (
                    <li key={server.id} className="mcpRow">
                      <div className="mcpRowMain">
                        <span className="mcpName">{server.id}</span>
                        <span className="mcpTransport">
                          {TRANSPORTS.find((entry) => entry.id === server.transport)?.label ?? server.transport}
                        </span>
                        <span className="mcpTarget" data-on={where.claude}>
                          Claude Code
                        </span>
                        <span className="mcpTarget" data-on={where.codex}>
                          Codex
                        </span>
                      </div>
                      <p className="mcpWhere">{server.url ?? server.command ?? ""}</p>
                      {where.note ? <p className="mcpNote">{where.note}</p> : null}
                      <div className="mcpRowActions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setDraft(serverToDraft(server));
                            setEditing(server.id);
                            setProblems([]);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => onSave(servers.filter((entry) => entry.id !== server.id))}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>

        <form
          className="mcpForm"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h3>{editing ? `Edit ${editing}` : "Add a server"}</h3>

          <div className="mcpField">
            <label htmlFor="mcp-name">Name</label>
            <input
              id="mcp-name"
              value={draft.id}
              onChange={(event) => set("id", event.target.value)}
              placeholder="my-server"
            />
          </div>

          <fieldset className="mcpTransports">
            <legend>How it is reached</legend>
            {TRANSPORTS.map((entry) => (
              <div key={entry.id} className="mcpRadio">
                <input
                  type="radio"
                  name="transport"
                  id={`mcp-transport-${entry.id}`}
                  // The hint is a description, not part of the name. Nested
                  // inside the label it became one: the first version of this
                  // announced as "Local processA command Docket's CLI starts
                  // and talks to..." -- caught by reading the accessibility
                  // tree, the same way the tab labels were.
                  aria-describedby={`mcp-transport-${entry.id}-hint`}
                  checked={draft.transport === entry.id}
                  onChange={() => set("transport", entry.id)}
                />
                <label htmlFor={`mcp-transport-${entry.id}`}>{entry.label}</label>
                <small id={`mcp-transport-${entry.id}-hint`}>{entry.hint}</small>
              </div>
            ))}
          </fieldset>

          {remote ? (
            <>
              <div className="mcpField">
                <label htmlFor="mcp-url">URL</label>
                <input
                  id="mcp-url"
                  value={draft.url}
                  onChange={(event) => set("url", event.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </div>
              <div className="mcpField">
                <label htmlFor="mcp-headers">
                  Headers, one <code>NAME=value</code> per line
                </label>
                <textarea
                  id="mcp-headers"
                  aria-describedby="mcp-headers-hint"
                  rows={2}
                  value={draft.headers}
                  onChange={(event) => set("headers", event.target.value)}
                />
                <small id="mcp-headers-hint">
                  Both CLIs store these in plain text. For a credential, prefer a header sourced from an
                  environment variable, which Codex supports and <code>.mcp.json</code> does not.
                </small>
              </div>
            </>
          ) : (
            <>
              <div className="mcpField">
                <label htmlFor="mcp-command">Command</label>
                <input
                  id="mcp-command"
                  value={draft.command}
                  onChange={(event) => set("command", event.target.value)}
                  placeholder="npx"
                />
              </div>
              <div className="mcpField">
                <label htmlFor="mcp-args">Arguments, one per line</label>
                <textarea
                  id="mcp-args"
                  rows={2}
                  value={draft.args}
                  onChange={(event) => set("args", event.target.value)}
                />
              </div>
              <div className="mcpField">
                <label htmlFor="mcp-env">
                  Environment, one <code>NAME=value</code> per line
                </label>
                <textarea
                  id="mcp-env"
                  rows={2}
                  value={draft.env}
                  onChange={(event) => set("env", event.target.value)}
                />
              </div>
            </>
          )}

          <div className="mcpField">
            <label htmlFor="mcp-blocked">Tools to block, separated by commas</label>
            <textarea
              id="mcp-blocked"
              aria-describedby="mcp-blocked-hint"
              rows={1}
              value={draft.disabledTools}
              onChange={(event) => set("disabledTools", event.target.value)}
            />
            <small id="mcp-blocked-hint">
              Codex hides these. Claude Code offers them and refuses the call, and only on a remote server — on a
              local one it drops the restriction entirely.
            </small>
          </div>

          <div className="mcpCheck">
            <input
              type="checkbox"
              id="mcp-enabled"
              aria-describedby="mcp-enabled-hint"
              checked={draft.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
            />
            <label htmlFor="mcp-enabled">Enabled</label>
            <small id="mcp-enabled-hint">
              Codex can hold a server that is off. Claude Code cannot, so an off server is left out of its file.
            </small>
          </div>

          {problems.length > 0 ? (
            <ul className="mcpProblems" role="alert">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <div className="mcpFormActions">
            <button type="submit" className="primary" disabled={busy}>
              {editing ? "Save changes" : "Add server"}
            </button>
            {editing ? (
              <button type="button" className="ghost" onClick={reset}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <section className="mcpApply">
          <div className="mcpFormActions">
            <button type="button" className="primary" onClick={onApply} disabled={busy || servers.length === 0}>
              Write to both CLIs
            </button>
            <button type="button" className="ghost" onClick={onImport} disabled={busy}>
              Import from .mcp.json
            </button>
          </div>

          {report ? <ApplyReport report={report} /> : null}
        </section>
    </Pane>
  );
}

/**
 * Three lists, not one.
 *
 * "Written" is the outcome. "Changed on the way" is a field that survived in a
 * different shape. "Not carried" is a field that did not survive at all, ranked
 * so a lost restriction is never below a lost preference.
 */
function ApplyReport({ report }: { report: McpApplyReport }) {
  return (
    <div className="mcpReport">
      <h3>What happened</h3>
      <ul className="mcpTargets">
        {[
          { label: "Claude Code", target: report.claude },
          { label: "Codex", target: report.codex },
        ].map(({ label, target }) => (
          <li key={label}>
            <span className="mcpTarget" data-on={target.written}>
              {label}
            </span>
            <code>{target.path}</code>
            <p>{target.detail}</p>
          </li>
        ))}
      </ul>

      {report.notes.length > 0 ? (
        <>
          <h4>Carried across, but changed</h4>
          <ul className="mcpNotes">
            {report.notes.map((note) => (
              <li key={`${note.server}.${note.field}`}>
                <strong>
                  {note.server}.{note.field}
                </strong>{" "}
                {note.detail}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {report.losses.length > 0 ? (
        <>
          <h4>Not carried</h4>
          <ul className="mcpLosses">
            {report.losses.map((loss) => (
              <li key={`${loss.server}.${loss.field}`} data-severity={loss.severity}>
                <span className="mcpSeverity">{loss.severity}</span>
                <strong>
                  {loss.server}.{loss.field}
                </strong>{" "}
                {loss.detail}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {report.notes.length === 0 && report.losses.length === 0 ? (
        <p className="empty">Every field reached both CLIs unchanged.</p>
      ) : null}
    </div>
  );
}
