/**
 * Makes the team room show what the agents are actually doing.
 *
 * The charters Docket writes are real subagent definitions, so the CLI already
 * delegates to them. What was missing is Docket knowing when that happens.
 *
 * The obvious approach -- reading the terminal and looking for agent names --
 * is guesswork against output that is formatted for humans and changes between
 * releases. Instead this installs the CLI's own lifecycle hooks, which report
 * the agent by type and identifier, and appends each event to a log the app
 * tails. What appears in the room is then reported by the tool doing the work,
 * not inferred from how it printed.
 *
 * Two choices worth keeping:
 *
 *   settings.local.json, not settings.json. The hook carries an absolute path
 *   that is meaningless on another machine, and the local file is the one that
 *   is not committed.
 *
 *   An inline `cat >>` rather than a script. Docket should not drop an
 *   executable into someone's repository to watch their work.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createReadStream, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentId } from "../shared/agent-roster";
import { AGENT_ROSTER } from "../shared/agent-roster";

/** Marks the hook entries Docket owns, so a person's own hooks are untouched. */
const MARKER = "docket:agent-events";

const HANDLE_TO_ID = new Map<string, AgentId>(AGENT_ROSTER.map((entry) => [entry.handle, entry.id]));

export type AgentEvent = Readonly<{
  kind: "start" | "stop";
  agentId: AgentId;
  /** Distinguishes two runs of the same agent. */
  runId: string;
  /** Present on stop: what the agent reported back. */
  summary: string | null;
  at: number;
}>;

type HookEntry = { type: string; command: string; args?: string[]; [key: string]: unknown };
type HookMatcher = { matcher?: string; hooks: HookEntry[]; [key: string]: unknown };
type Settings = { hooks?: Record<string, HookMatcher[]>; [key: string]: unknown };

/**
 * Adds Docket's hooks to whatever is already configured, replacing only its own
 * previous entries. Exported for tests: clobbering a person's hook config is
 * the kind of mistake that is discovered days later, in someone else's work.
 */
export function mergeHooks(existing: Settings, logPath: string): Settings {
  const command: HookEntry = {
    type: "command",
    // Quoting matters: workspace paths contain spaces more often than not.
    command: "/bin/sh",
    args: ["-c", `cat >> '${logPath.replace(/'/g, "'\\''")}'`],
    statusMessage: MARKER,
  };

  const hooks = { ...(existing.hooks ?? {}) };
  for (const event of ["SubagentStart", "SubagentStop"]) {
    const mine: HookMatcher = { matcher: "*", hooks: [command] };
    const theirs = (hooks[event] ?? []).filter(
      (entry) => !entry.hooks?.some((hook) => hook.statusMessage === MARKER),
    );
    hooks[event] = [...theirs, mine];
  }
  return { ...existing, hooks };
}

export async function installAgentHooks(workspacePath: string, logPath: string): Promise<void> {
  const settingsPath = join(workspacePath, ".claude", "settings.local.json");
  await mkdir(dirname(settingsPath), { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });

  let existing: Settings = {};
  try {
    existing = JSON.parse(await readFile(settingsPath, "utf8")) as Settings;
  } catch (error) {
    // A malformed file is left for its owner to fix rather than overwritten;
    // only a missing one is treated as an empty starting point.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Could not read .claude/settings.local.json; fix or remove it to let Docket install its hooks");
    }
  }

  const temporary = `${settingsPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(mergeHooks(existing, logPath), null, 2)}\n`, "utf8");
  await rename(temporary, settingsPath);
}

/**
 * Parses one hook payload. Unknown agents are dropped rather than guessed at:
 * the CLI has built-in agent types of its own, and showing "Explore" as a
 * member of the user's team would be a lie about who is on it.
 */
export function parseAgentEvent(line: string): AgentEvent | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = typeof payload.agent_type === "string" ? payload.agent_type : null;
  const agentId = type ? HANDLE_TO_ID.get(type) : undefined;
  if (!agentId) return null;

  const event = payload.hook_event_name;
  const kind = event === "SubagentStart" ? "start" : event === "SubagentStop" ? "stop" : null;
  if (!kind) return null;

  const summary = typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : null;
  return {
    kind,
    agentId,
    runId: typeof payload.agent_id === "string" ? payload.agent_id : `${agentId}-${Date.now()}`,
    summary,
    at: Date.now(),
  };
}

/**
 * Follows the event log, reporting only what is appended after this call.
 *
 * Reads from a byte offset rather than re-reading the file, so a long session
 * does not re-emit its history on every write, and holds partial trailing lines
 * back until their newline arrives -- an event can be written in two chunks.
 */
export function watchAgentEvents(logPath: string, onEvent: (event: AgentEvent) => void): () => void {
  // Starts at the current end of the log. Without this the first append reads
  // from byte zero and replays a whole previous session into the room.
  let offset = 0;
  try {
    offset = statSync(logPath).size;
  } catch {
    // No log yet: the first subagent to run creates it, and reading from zero
    // is then correct.
  }
  let pending = "";
  let reading = false;
  let watcher: FSWatcher | null = null;
  let closed = false;

  const drain = () => {
    if (reading || closed) return;
    reading = true;

    const chunks: Buffer[] = [];
    const stream = createReadStream(logPath, { start: offset });
    stream.on("data", (chunk) => chunks.push(chunk as Buffer));
    // A missing log is the normal state until the first subagent runs.
    stream.on("error", () => {
      reading = false;
    });
    stream.on("close", () => {
      const text = pending + Buffer.concat(chunks).toString("utf8");
      offset += chunks.reduce((total, chunk) => total + chunk.length, 0);
      const lines = text.split("\n");
      // The last element is whatever follows the final newline: either empty,
      // or half of an event still being written.
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const event = parseAgentEvent(line);
        if (event) onEvent(event);
      }
      reading = false;
    });
  };

  try {
    watcher = watch(dirname(logPath), (_type, filename) => {
      if (!filename || !logPath.endsWith(filename.toString())) return;
      drain();
    });
  } catch {
    // Without a watcher the room simply stays quiet; it must not stop the app.
  }

  return () => {
    closed = true;
    watcher?.close();
  };
}
