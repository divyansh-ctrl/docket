/**
 * Decides which agents a repository actually needs.
 *
 * Docket spawns a small team rather than the whole roster: a static site has no
 * use for a migration owner, and paying an opus-class reviewer to sit idle in a
 * repository with no tests is waste the user can see on their bill.
 *
 * The rules are deliberately data, and the input is a plain description of the
 * repository rather than the filesystem, so the whole decision is testable
 * without creating fixture directories.
 *
 * Every selection carries the concrete signal that produced it. The reason
 * shown in the UI is never "we thought you might need this" -- it names the
 * file or dependency that made the case.
 */
import { AGENT_ROSTER, type AgentId } from "./agent-roster";

export type RepositoryProbe = Readonly<{
  /** Repository-relative paths. Separators may be either kind. */
  files: readonly string[];
  /** Dependency names collected from whatever manifests were found. */
  dependencies: readonly string[];
}>;

export type AgentSelection = Readonly<{
  id: AgentId;
  /** Why this agent is on the team, in the user's language. */
  reason: string;
  /** The specific paths or packages that triggered it. Empty for core agents. */
  evidence: readonly string[];
}>;

type Rule = Readonly<{
  agent: AgentId;
  reason: string;
  dependencies?: readonly string[];
  paths?: readonly RegExp[];
}>;

/** Shown per agent; enough to be convincing, short enough to read. */
const MAX_EVIDENCE = 3;

const RULES: readonly Rule[] = Object.freeze([
  {
    agent: "tests",
    reason: "This repository has a test suite",
    dependencies: [
      "jest",
      "vitest",
      "mocha",
      "jasmine",
      "ava",
      "tap",
      "@playwright/test",
      "cypress",
      "pytest",
      "unittest2",
      "rspec",
      "minitest",
      "junit",
      "phpunit",
      "testify",
    ],
    paths: [
      /(^|\/)tests?\//,
      /(^|\/)__tests__\//,
      /(^|\/)spec\//,
      /\.(test|spec)\.[cm]?[jt]sx?$/,
      /_test\.(go|py|rb|rs)$/,
      /(^|\/)test_[^/]+\.py$/,
    ],
  },
  {
    agent: "interface",
    reason: "This repository has a user interface",
    dependencies: [
      "react",
      "react-dom",
      "vue",
      "svelte",
      "@angular/core",
      "next",
      "nuxt",
      "@remix-run/react",
      "solid-js",
      "preact",
      "tailwindcss",
      "@sveltejs/kit",
      "astro",
      "electron",
    ],
    paths: [/\.(tsx|jsx|vue|svelte)$/, /\.(css|scss|sass|less)$/, /(^|\/)index\.html$/],
  },
  {
    agent: "data",
    reason: "This repository owns a schema",
    dependencies: [
      "prisma",
      "@prisma/client",
      "drizzle-orm",
      "typeorm",
      "sequelize",
      "knex",
      "mongoose",
      "sqlalchemy",
      "alembic",
      "django",
      "activerecord",
      "gorm",
      "diesel",
    ],
    paths: [
      /(^|\/)migrations?\//,
      /(^|\/)alembic\//,
      /schema\.prisma$/,
      /\.sql$/,
      /(^|\/)schema\.(rb|sql|graphql)$/,
    ],
  },
  {
    agent: "release",
    reason: "This repository builds and ships something",
    dependencies: ["electron-builder", "@electron-forge/cli", "semantic-release", "goreleaser"],
    paths: [
      /(^|\/)\.github\/workflows\//,
      /(^|\/)\.gitlab-ci\.yml$/,
      /(^|\/)Dockerfile$/,
      /(^|\/)docker-compose\.ya?ml$/,
      /\.tf$/,
      /(^|\/)Makefile$/,
      /(^|\/)helm\//,
      /(^|\/)\.circleci\//,
    ],
  },
  {
    agent: "security",
    reason: "This repository handles credentials or untrusted input",
    dependencies: [
      "passport",
      "jsonwebtoken",
      "jose",
      "bcrypt",
      "bcryptjs",
      "argon2",
      "next-auth",
      "@auth/core",
      "oauth",
      "oauth2",
      "helmet",
      "express-session",
      "cryptography",
      "pyjwt",
      "devise",
    ],
    paths: [
      /(^|\/)auth[^/]*\//,
      /(^|\/)\.env(\.|$)/,
      /(^|\/)middleware\//,
      // Source only. A document *about* security is not security surface, and
      // citing one as the reason an agent joined is evidence the user cannot
      // check.
      /(^|\/)security[^/]*\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|php)$/,
      /(^|\/)SECURITY\.md$/,
    ],
  },
  {
    agent: "docs",
    reason: "This repository has documentation to keep true",
    dependencies: ["docusaurus", "@docusaurus/core", "mkdocs", "sphinx", "vitepress", "typedoc"],
    paths: [/(^|\/)docs?\//, /(^|\/)mkdocs\.ya?ml$/, /(^|\/)README\.md$/i, /\.mdx$/],
  },
]);

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Returns the team for this repository, in roster order so the room does not
 * reshuffle between openings.
 */
export function detectAgents(probe: RepositoryProbe): readonly AgentSelection[] {
  const files = probe.files.map(normalize);
  // Dependency names are compared case-insensitively: registries disagree about
  // casing, and a missed match here silently drops an agent from the team.
  const dependencies = new Set(probe.dependencies.map((name) => name.toLowerCase()));

  const selections = new Map<AgentId, AgentSelection>();

  for (const definition of AGENT_ROSTER) {
    if (!definition.core) continue;
    selections.set(definition.id, {
      id: definition.id,
      reason: "Always on the team",
      evidence: [],
    });
  }

  for (const rule of RULES) {
    const evidence: string[] = [];

    for (const name of rule.dependencies ?? []) {
      if (dependencies.has(name.toLowerCase())) evidence.push(name);
    }
    for (const pattern of rule.paths ?? []) {
      const hit = files.find((file) => pattern.test(file));
      if (hit) evidence.push(hit);
    }

    if (evidence.length === 0) continue;

    // A rule can fire on several signals; keep the first few, deduplicated, so
    // the reason stays readable.
    const unique = [...new Set(evidence)].slice(0, MAX_EVIDENCE);
    const existing = selections.get(rule.agent);
    selections.set(rule.agent, {
      id: rule.agent,
      reason: rule.reason,
      evidence: existing ? [...new Set([...existing.evidence, ...unique])].slice(0, MAX_EVIDENCE) : unique,
    });
  }

  return Object.freeze(
    AGENT_ROSTER.filter((definition) => selections.has(definition.id)).map(
      (definition) => selections.get(definition.id) as AgentSelection,
    ),
  );
}

/** Directory and file names never worth walking into when probing a repository. */
export const IGNORED_DIRECTORIES: readonly string[] = Object.freeze([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  ".idea",
  "coverage",
  ".vite",
  ".turbo",
  ".cache",
]);
