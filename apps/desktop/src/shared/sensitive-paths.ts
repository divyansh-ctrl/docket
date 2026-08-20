/**
 * Files that govern how a change is verified, rather than what it does.
 *
 * Everything else in a packet answers "is this change correct". These answer a
 * prior question: **is the rest of this packet worth what it appears to be
 * worth.** A suite that passes proves less if the same change edited the
 * workflow that runs it, the lockfile that supplies its dependencies, or the
 * ignore rules that decide what Docket can see.
 *
 * Check drift already covers one case: a check whose *definition* moved since
 * the last commit. This covers the surrounding machinery, which drift cannot
 * see because none of it is a declared check.
 *
 * Two things this is careful about.
 *
 * **It is a fact, not a suspicion.** A path changed; that is observed, and it
 * is all that is claimed. Editing CI is ordinary work most of the time. So the
 * wording says what the change means for the other evidence -- not that
 * something is wrong, and never that an intent was concealed.
 *
 * **It is not blocking.** A gate that stopped every branch touching
 * `.github/workflows` would be overridden within a week and would then be
 * stopping nothing. These sit at the level that makes a reviewer read the diff,
 * which is the action actually wanted.
 *
 * The list is grounded in what real repositories carry, and each entry names
 * why it is here. A category nobody can justify in one sentence does not
 * belong: this section's value is that everything in it repays a look.
 */

export type SensitiveCategory = Readonly<{
  id: string;
  /** What the reviewer is told changed. */
  label: string;
  /** What its changing means for the rest of the packet. */
  consequence: string;
  severity: "attention" | "note";
  pattern: RegExp;
}>;

export const CATEGORIES: readonly SensitiveCategory[] = Object.freeze([
  {
    id: "ci-config",
    label: "continuous integration configuration",
    consequence:
      "The checks reported here were run under a configuration this change edits, so a green result describes the new rules rather than the ones the repository agreed on.",
    severity: "attention",
    pattern:
      /(?:^|\/)(?:\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/|azure-pipelines\.ya?ml$|Jenkinsfile$|\.travis\.yml$|appveyor\.yml$|\.buildkite\/|\.woodpecker\.ya?ml$)/i,
  },
  {
    id: "git-hooks",
    label: "Git hook configuration",
    consequence:
      "Hooks run on commit and push, before anything here sees the change. A repository whose hooks moved is one whose local gate moved.",
    severity: "attention",
    pattern: /(?:^|\/)(?:\.husky\/|\.githooks\/|lefthook\.ya?ml$|\.pre-commit-config\.ya?ml$)/i,
  },
  {
    id: "docket-config",
    label: "Docket's own check declaration",
    consequence:
      "This file decides which checks exist. A change to it changes what this packet was able to run, which is not visible anywhere else in it.",
    severity: "attention",
    pattern: /(?:^|\/)docket\.json$/,
  },
  {
    id: "agent-config",
    label: "agent tooling configuration",
    consequence:
      "The claims compared in this packet arrive through the CLI's own hook events, and the tools an agent can reach are declared alongside them. Configuration that decides which hooks fire, or which MCP servers an agent can call, decides what this packet could have caught.",
    severity: "attention",
    // `.mcp.json` declares MCP servers, and an MCP server is a set of tools an
    // agent can call. It was missed here until Docket began writing the file
    // itself, which is the wrong order to notice it in.
    //
    // `config.toml` was missed for a duller reason: the rule only matched
    // `.json`, and Codex's configuration has never been JSON.
    pattern:
      /(?:^|\/)\.mcp\.json$|(?:^|\/)\.(?:claude|codex)\/(?:settings|config)[^/]*\.(?:json|toml)$|(?:^|\/)\.(?:claude|codex)\/hooks\//i,
  },
  {
    id: "container-definition",
    label: "container definition",
    consequence:
      "Checks reported as contained ran inside an image this change defines, so what \"contained\" covered is part of the diff rather than a fixed background.",
    severity: "attention",
    pattern:
      /(?:^|\/)(?:Dockerfile[^/]*|Containerfile|docker-compose(?:\.[^/]+)?\.ya?ml|\.dockerignore)$/i,
  },
  {
    id: "install-hook",
    label: "a package manifest that can run code on install",
    consequence:
      "An install lifecycle script executes on any machine that installs this project, including build machines, before any check runs.",
    // Matched on content by the caller, not on the path: package.json changes
    // constantly and almost none of those changes are this.
    severity: "attention",
    pattern: /(?:^|\/)package\.json$/,
  },
  {
    id: "ignore-rules",
    label: "ignore rules",
    consequence:
      "What Docket can see is what Git reports. A pattern added here can remove a file from every diff in this packet without removing it from the repository.",
    severity: "attention",
    pattern: /(?:^|\/)\.(?:gitignore|npmignore)$/,
  },
  {
    id: "dependency-lock",
    label: "a dependency lockfile",
    consequence:
      "Locked versions decide what code the checks actually ran against. Reported quietly because lockfiles move constantly, and loudly enough to notice when nothing else in the change explains it.",
    severity: "note",
    pattern:
      /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/i,
  },
]);

export type SensitiveChange = Readonly<{
  categoryId: string;
  label: string;
  consequence: string;
  severity: SensitiveCategory["severity"];
  paths: readonly string[];
}>;

/**
 * Groups changed paths by what they govern.
 *
 * A path can land in more than one category, and does: `docket.json` is both
 * Docket's declaration and, in some repositories, nothing else. Reporting it
 * once per category it genuinely belongs to is right -- the consequences differ,
 * and a reviewer needs both sentences.
 *
 * `installHooks` names the package manifests whose install lifecycle actually
 * changed, decided by the caller from the diff rather than from the path.
 * Every `package.json` edit would otherwise be reported, and almost none of
 * them adds a `postinstall`.
 */
export function classifyPaths(
  paths: readonly string[],
  installHooks: readonly string[] = [],
): readonly SensitiveChange[] {
  const found: SensitiveChange[] = [];

  for (const category of CATEGORIES) {
    const matched =
      category.id === "install-hook"
        ? paths.filter((path) => installHooks.includes(path))
        : paths.filter((path) => category.pattern.test(path));
    if (matched.length === 0) continue;
    found.push({
      categoryId: category.id,
      label: category.label,
      consequence: category.consequence,
      severity: category.severity,
      paths: [...matched].sort(),
    });
  }

  return found;
}

/** The npm lifecycle keys that run code without anyone asking for it. */
const LIFECYCLE = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "prepack",
] as const;

/**
 * Whether an added line declares an install lifecycle script.
 *
 * Text rather than JSON, because the input is a diff: the manifest as a whole
 * may not parse mid-change, and only the added lines are the change. A false
 * positive here is a line in some other file that happens to read like
 * `"postinstall":`, which is a cheap mistake compared to missing the real one.
 */
export function declaresInstallHook(line: string): boolean {
  return LIFECYCLE.some((key) => new RegExp(`"${key}"\\s*:`).test(line));
}
