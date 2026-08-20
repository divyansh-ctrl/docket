import type { ProviderId, TerminalPurpose } from "../shared/ipc-contract";

const DOCUMENTATION_HOSTS = new Set([
  "developers.openai.com",
  "docs.anthropic.com",
  "support.anthropic.com",
  "support.claude.com",
]);

const ALLOWLISTED_COMMANDS = new Set([
  "codex:login:login",
  "claude:login:auth,login,--console",
  "claude:login:auth,login,--claudeai",
  "codex:session:",
  "claude:session:",
]);

export function assertAllowlistedCommand(
  provider: ProviderId,
  purpose: TerminalPurpose,
  args: readonly string[],
): void {
  const key = `${provider}:${purpose}:${args.join(",")}`;
  if (!ALLOWLISTED_COMMANDS.has(key)) {
    throw new Error("Rejected non-allowlisted provider command");
  }
}

/**
 * Read-only provider commands, kept apart from the session allowlist above.
 *
 * These reach the same executables without a terminal, so they get the same
 * exact-match discipline -- with one deliberate exception. `codex mcp get`
 * takes a server name, which cannot be enumerated in advance, so the verb is
 * fixed and the argument is validated instead. The pattern is the one Docket
 * already enforces when a server is created, so a name that fails here is one
 * Docket could not have written.
 */
const ALLOWLISTED_READS = new Set(["codex:mcp,list,--json"]);

/** Fixed verb, one validated argument. Nothing else takes a parameter. */
const PARAMETERISED_READS: readonly Readonly<{ key: string; argument: RegExp }>[] = Object.freeze([
  { key: "codex:mcp,get", argument: /^[A-Za-z0-9][A-Za-z0-9_-]*$/ },
]);

export function assertAllowlistedRead(provider: ProviderId, args: readonly string[]): void {
  const key = `${provider}:${args.join(",")}`;
  if (ALLOWLISTED_READS.has(key)) return;

  for (const entry of PARAMETERISED_READS) {
    const prefix = `${entry.key},`;
    if (!key.startsWith(prefix)) continue;
    const argument = key.slice(prefix.length);
    // One argument only: a comma here would mean a second was smuggled in.
    if (argument.includes(",") || !entry.argument.test(argument)) break;
    return;
  }

  throw new Error("Rejected non-allowlisted provider read");
}

export function isTrustedRendererUrl(value: string, trustedRendererUrl: string): boolean {
  try {
    const candidate = new URL(value);
    const trusted = new URL(trustedRendererUrl);
    if (trusted.protocol === "file:") {
      return candidate.protocol === "file:" && candidate.href === trusted.href;
    }
    return candidate.origin === trusted.origin;
  } catch {
    return false;
  }
}

export function parseAllowlistedDocsUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048) {
    throw new TypeError("Invalid documentation URL");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !DOCUMENTATION_HOSTS.has(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("Documentation URL is not allowlisted");
  }
  return url;
}

export function isAllowlistedDocsUrl(value: string): boolean {
  try {
    parseAllowlistedDocsUrl(value);
    return true;
  } catch {
    return false;
  }
}
