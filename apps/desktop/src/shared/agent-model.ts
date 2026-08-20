/**
 * Which model an agent runs, said precisely enough to be acted on.
 *
 * It used to be one word -- `opus`, `sonnet`, `inherit` -- which was enough
 * while every agent ran on Anthropic through Claude Code. It stops being enough
 * the moment a second service can serve a model, because a bare name does not
 * say who serves it.
 *
 * `z-ai/glm-5.2:free` on OpenRouter and the same weights pulled into a local
 * Ollama are the same model and **not** the same configuration: different
 * endpoint, different credential, different cost, different rate limit, and a
 * different answer to "why did this agent stop". Collapsing them to one label
 * would make the difference invisible in exactly the place someone would look
 * for it.
 *
 * So identity is the pair. The credential is named rather than held: this
 * record is written to Docket's own configuration file, and a value here would
 * be a secret at rest in a file that is not built to hold one.
 */

/** Services that can serve a model to a CLI Docket drives. */
export const MODEL_PROVIDERS = ["anthropic", "openai", "openrouter", "ollama", "lmstudio"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/**
 * `inherit` is not a provider. It means Docket states nothing and the agent
 * follows the session it was spawned from, which is the right default for an
 * agent whose cost should track the main conversation rather than be pinned.
 */
export type AgentModelChoice = Readonly<{
  provider: ModelProvider | "inherit";
  /** Empty exactly when inheriting. The id the provider knows it by. */
  model: string;
  /** The name of a stored credential, never its value. Null when none is needed. */
  credential: string | null;
}>;

export const INHERIT: AgentModelChoice = Object.freeze({ provider: "inherit", model: "", credential: null });

/** The aliases Claude Code accepts in subagent frontmatter. */
export const ANTHROPIC_ALIASES = ["opus", "sonnet", "haiku", "fable"] as const;

export function anthropic(alias: (typeof ANTHROPIC_ALIASES)[number]): AgentModelChoice {
  return Object.freeze({ provider: "anthropic", model: alias, credential: null });
}

/**
 * Providers that reach a model without a credential Docket has to hold.
 *
 * Ollama and LM Studio run locally and take no key. Anthropic goes through the
 * CLI's own sign-in, which is the whole reason Docket never asks for one.
 */
const NO_CREDENTIAL = new Set<string>(["anthropic", "ollama", "lmstudio", "inherit"]);

export function needsCredential(choice: AgentModelChoice): boolean {
  return !NO_CREDENTIAL.has(choice.provider);
}

/**
 * Read a stored choice, accepting the single string this used to be.
 *
 * The old shape is migrated rather than rejected: every value it could hold was
 * an Anthropic alias, so the provider is not a guess -- it is the only thing it
 * could have meant.
 */
export function readChoice(value: unknown): AgentModelChoice | null {
  if (typeof value === "string") {
    if (value === "inherit") return INHERIT;
    return (ANTHROPIC_ALIASES as readonly string[]).includes(value)
      ? anthropic(value as (typeof ANTHROPIC_ALIASES)[number])
      : null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const provider = record.provider;
  const model = record.model;
  const credential = record.credential;

  if (provider === "inherit") return INHERIT;
  if (typeof provider !== "string" || !(MODEL_PROVIDERS as readonly string[]).includes(provider)) return null;
  // A named provider with no model names nothing, which is worse than absent:
  // it would be written into a real charter as an empty setting.
  if (typeof model !== "string" || model.trim().length === 0) return null;

  return Object.freeze({
    provider: provider as ModelProvider,
    model: model.trim(),
    credential: typeof credential === "string" && credential.length > 0 ? credential : null,
  });
}

/**
 * What goes in `.claude/agents/<handle>.md` frontmatter, or null to omit it.
 *
 * Anthropic keeps its alias, which is what Claude Code's subagent system reads.
 * Anything else emits the model id, because reaching it means pointing Claude
 * Code at a gateway and the far end wants the id the gateway maps -- not a word
 * that only means something to Anthropic. Inheriting writes no key at all
 * rather than the word "inherit", so the file says nothing where Docket has
 * nothing to say.
 */
export function frontmatterModel(choice: AgentModelChoice): string | null {
  return choice.provider === "inherit" ? null : choice.model;
}

/** One line for `AGENTS.md`, where a bare alias would not say who serves it. */
export function describeChoice(choice: AgentModelChoice): string {
  if (choice.provider === "inherit") return "follows the session";
  return choice.provider === "anthropic" ? choice.model : `${choice.model} via ${choice.provider}`;
}

/** Same model, same service. Used to tell a real change from a re-selection. */
export function sameChoice(a: AgentModelChoice, b: AgentModelChoice): boolean {
  return a.provider === b.provider && a.model === b.model && a.credential === b.credential;
}

/**
 * The choices the settings surface offers today.
 *
 * Anthropic aliases plus inheriting -- what Docket could already reach before
 * this type existed. The list grows when there is a credential behind it; an
 * option that cannot be reached is a control that silently does nothing.
 */
export const OFFERED_CHOICES: readonly Readonly<{ id: string; label: string; choice: AgentModelChoice }>[] =
  Object.freeze([
    { id: "opus", label: "Opus \u00b7 deepest judgment", choice: anthropic("opus") },
    { id: "sonnet", label: "Sonnet \u00b7 balanced", choice: anthropic("sonnet") },
    { id: "haiku", label: "Haiku \u00b7 fastest, cheapest", choice: anthropic("haiku") },
    { id: "fable", label: "Fable \u00b7 fast, strong writing", choice: anthropic("fable") },
    { id: "inherit", label: "Follow the session", choice: INHERIT },
  ]);

/** The offered id for a stored choice, or null when nothing offered matches. */
export function offeredIdFor(choice: AgentModelChoice): string | null {
  return OFFERED_CHOICES.find((entry) => sameChoice(entry.choice, choice))?.id ?? null;
}
