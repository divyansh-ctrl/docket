# Applications

Runnable product surfaces live in this directory. Each application owns its
entry points, app-specific configuration, tests, and local run instructions.
Reusable domain logic should move to `packages/` only after a real second
consumer exists.

## Application index

| Application | Purpose | Status | Start here |
|---|---|---|---|
| [`desktop`](desktop/) | The product: local workbench that runs an installed Codex or Claude Code CLI in a restricted terminal, and where the merge gate is being built | Active MVP; unsigned on all platforms | [`desktop/README.md`](desktop/README.md) |
| [`site`](site/) | Download page, release manifest, and same-origin download worker | Live | [`site/README.md`](site/README.md) |
| [`dashboard`](dashboard/) | Earlier mission/ledger web prototype, retained as design reference | Prototype; all data simulated | [`dashboard/README.md`](dashboard/README.md) |

## Boundaries

- Applications may depend on shared packages; shared packages must not depend
  on applications.
- App-specific adapters and build integration stay with the app until their
  contract is stable and reused.
- A new application must include a `README.md`, deterministic verification
  commands, and an explicit owner before it is added to this index.
- Generated output, dependency directories, secrets, and local environment
  files are excluded by the repository-level `.gitignore`.

## Naming

Use lowercase kebab-case for new application directories and human-authored
files. Keep framework-required names such as `page.tsx`, `layout.tsx`,
`package.json`, and `vite.config.ts` unchanged.
