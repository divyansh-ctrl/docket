# Applications

Runnable product surfaces live in this directory. Each application owns its
entry points, app-specific configuration, tests, and local run instructions.
Reusable domain logic should move to `packages/` only after a real second
consumer exists.

## Application index

| Application | Purpose | Status | Start here |
|---|---|---|---|
| [`dashboard`](dashboard/) | Interactive evidence-first operations workbench | Product prototype with simulated data | [`dashboard/README.md`](dashboard/README.md) |
| [`desktop`](desktop/) | Downloadable Codex/Claude controller with a restricted local terminal | Active desktop MVP; unsigned macOS build | [`desktop/README.md`](desktop/README.md) |

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
