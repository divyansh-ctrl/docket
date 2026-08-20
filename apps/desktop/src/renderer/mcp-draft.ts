/**
 * Turning what someone typed into a server record, and saying where it will run.
 *
 * Kept out of the component for the reason `tabs.ts` is: a form that quietly
 * accepts a malformed server writes a broken file, and the failure surfaces
 * when an agent cannot start rather than when the mistake was made. These rules
 * are the ones worth holding to a test.
 */
import type { McpServer, McpTransport } from "../shared/mcp-config";

export type Draft = Readonly<{
  id: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
  disabledTools: string;
  enabled: boolean;
}>;

export const EMPTY_DRAFT: Draft = Object.freeze({
  id: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  headers: "",
  disabledTools: "",
  enabled: true,
});

/** One argument per line: a shell split would need quoting rules nobody wants. */
export function parseLines(text: string): readonly string[] {
  return Object.freeze(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

/** `NAME=value` per line. The first `=` splits, so a value may contain more. */
export function parsePairs(text: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return Object.freeze(out);
}

export function parseList(text: string): readonly string[] {
  return Object.freeze(
    text
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

/**
 * A server id has to survive being a TOML key and a JSON key, and has to be
 * recognisable in a `/mcp` listing. Both CLIs accept more than this; Docket is
 * stricter on the way in because a name is easier to fix before it is written
 * into two files than after.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type DraftResult = Readonly<{ server: McpServer | null; problems: readonly string[] }>;

export function draftToServer(draft: Draft, existingIds: readonly string[] = []): DraftResult {
  const problems: string[] = [];
  const id = draft.id.trim();

  if (id.length === 0) problems.push("Give the server a name.");
  else if (!ID.test(id)) problems.push("A name may use letters, digits, hyphens and underscores, and must start with a letter or digit.");
  else if (existingIds.includes(id)) problems.push(`There is already a server called ${id}.`);

  const remote = draft.transport !== "stdio";
  if (remote) {
    const url = draft.url.trim();
    if (url.length === 0) problems.push("A remote server needs a URL.");
    else if (!/^(https?|wss?):\/\//i.test(url)) problems.push("The URL needs a scheme: http, https, ws or wss.");
  } else if (draft.command.trim().length === 0) {
    problems.push("A local server needs a command to run.");
  }

  if (problems.length > 0) return Object.freeze({ server: null, problems: Object.freeze(problems) });

  const args = parseLines(draft.args);
  const env = parsePairs(draft.env);
  const headers = parsePairs(draft.headers);
  const disabledTools = parseList(draft.disabledTools);

  const server: Record<string, unknown> = { id, transport: draft.transport };
  if (remote) {
    server.url = draft.url.trim();
    if (Object.keys(headers).length > 0) server.headers = headers;
  } else {
    server.command = draft.command.trim();
    if (args.length > 0) server.args = args;
    if (Object.keys(env).length > 0) server.env = env;
  }
  if (disabledTools.length > 0) server.disabledTools = disabledTools;
  // Only written when off: absent means on in both CLIs, and writing the
  // default would suggest Docket had an opinion it does not have.
  if (!draft.enabled) server.enabled = false;

  return Object.freeze({ server: Object.freeze(server) as McpServer, problems: Object.freeze([]) });
}

/** The inverse, so editing an existing server starts from what it is. */
export function serverToDraft(server: McpServer): Draft {
  const pairs = (record: Readonly<Record<string, string>> | undefined): string =>
    record ? Object.keys(record).sort().map((key) => `${key}=${record[key]}`).join("\n") : "";
  return Object.freeze({
    id: server.id,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join("\n"),
    url: server.url ?? "",
    env: pairs(server.env),
    headers: pairs(server.headers),
    disabledTools: (server.disabledTools ?? []).join(", "),
    enabled: server.enabled !== false,
  });
}

export type Reach = Readonly<{ claude: boolean; codex: boolean; note: string | null }>;

/**
 * Which CLIs will actually run this server.
 *
 * Codex has one remote transport and infers it from the presence of a URL, so
 * an `sse` or `ws` server would be accepted, misread as streamable HTTP, and
 * fail only in use. Saying so on the row is cheaper than saying it in a report
 * after someone has already pressed Apply.
 */
export function reach(server: McpServer): Reach {
  if (server.transport === "sse" || server.transport === "ws") {
    const named = server.transport === "sse" ? "a server-sent events" : "a WebSocket";
    return Object.freeze({
      claude: true,
      codex: false,
      note: `Codex speaks only streamable HTTP, so it cannot reach ${named} server.`,
    });
  }
  if (server.enabled === false) {
    return Object.freeze({
      claude: false,
      codex: true,
      note: "Switched off. Codex can hold a server that is off; Claude Code cannot, so it is left out of .mcp.json.",
    });
  }
  return Object.freeze({ claude: true, codex: true, note: null });
}
