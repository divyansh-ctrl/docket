# AOS project structure

**Status:** current prototype organization  
**Reviewed:** 2026-08-13

This map keeps product evidence, design guidance, the runnable prototype, and
future production boundaries easy to find without implying that reserved
directories already contain a runtime.

## Current tree

```text
aos/
├── README.md
├── apps/
│   ├── README.md
│   ├── dashboard/                 # Runnable interactive web prototype
│   └── desktop/                   # Electron desktop application
├── design-system/
│   └── aos/                       # Generated UI/UX source of truth
├── docs/
│   ├── README.md
│   ├── PRODUCT.md                 # Stable product entry point
│   ├── ROADMAP.md                 # Stable delivery entry point
│   ├── PROJECT-STRUCTURE.md       # This repository map
│   ├── architecture/              # Runtime contracts and accepted decisions
│   └── research/                  # Dated evidence and reference artifacts
├── infra/
│   └── README.md                  # Reserved; no production infra yet
└── packages/
    └── README.md                  # Reserved; no shared packages yet
```

Generated dashboard dependencies and build output are intentionally omitted
from the tree. They are local artifacts, not source boundaries.

## Ownership boundaries

| Path | Owns | Must not imply or contain |
|---|---|---|
| `apps/dashboard/` | UI prototype, app configuration, app tests, and app-specific build integration | Live model execution unless it is implemented and truthfully labelled |
| `apps/desktop/` | Sandboxed desktop UI, narrow local IPC, provider detection, and purpose-bound PTY sessions | Provider credentials, arbitrary shell execution, or silent session switching |
| `design-system/aos/` | Generated design tokens, component guidance, and page overrides | Runtime policy or product claims |
| `docs/` | Product intent, roadmap, architecture, research, and decision history | Credentials, customer data, or undocumented runtime guarantees |
| `infra/` | Future deployment and isolation configuration | Application domain logic or committed secrets |
| `packages/` | Future reusable contracts and libraries | Application entry points or speculative empty modules |

## Naming convention

- Use lowercase kebab-case for new directories and human-authored files:
  `model-registry/`, `work-unit-schema.ts`, `cost-policy.md`.
- Keep framework and ecosystem conventions unchanged: `README.md`,
  `package.json`, `package-lock.json`, `tsconfig.json`, `page.tsx`, `layout.tsx`,
  `globals.css`, and `.openai/hosting.json`.
- Keep the current stable documentation entry points `PRODUCT.md`, `ROADMAP.md`,
  and `PROJECT-STRUCTURE.md` so existing navigation remains valid.
- Keep the generated design-system entry point `MASTER.md` and its current
  `pages/dashboard.md` override path; new generated page overrides use
  lowercase kebab-case page names.
- Architecture decisions use `adr-NNN-short-decision.md`.
- Tests use a source-oriented suffix such as `*.test.ts`, `*.test.tsx`, or the
  runner's required equivalent.

## Current scaffold exceptions

- `apps/dashboard/build/sites-vite-plugin.ts` is source code required by the
  Sites/vinext scaffold. The directory name is therefore not treated as a
  disposable `build/` output directory.
- `apps/dashboard` currently contains its own `.git` metadata from the site
  initializer. Do not delete or flatten it automatically. Before publishing a
  single monorepo, explicitly decide whether repository history is owned by the
  root or by independently versioned applications.
- `apps/dashboard/node_modules/`, `.next/`, `.vinext/`, `.wrangler/`, and `dist/`
  are generated local artifacts and are excluded by the root `.gitignore`.

## Adding a deliverable

1. Choose the owning boundary before creating files.
2. Use the naming rules above and avoid speculative empty directories.
3. Add a local `README.md` when introducing a runnable app, shared package, or
   infrastructure unit.
4. Add deterministic validation commands and state whether data is real,
   simulated, or proposed.
5. Update the nearest directory index and then this map if the top-level shape
   changed.
6. Verify internal Markdown links and the repository tree before handoff.

## Navigation

- Product and delivery: [`README.md`](README.md)
- Architecture: [`architecture/README.md`](architecture/README.md)
- Research: [`research/README.md`](research/README.md)
- Dashboard: [`../apps/dashboard/README.md`](../apps/dashboard/README.md)
- UI guidance: [`../design-system/aos/MASTER.md`](../design-system/aos/MASTER.md)
