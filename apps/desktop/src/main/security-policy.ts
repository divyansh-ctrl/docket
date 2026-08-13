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
