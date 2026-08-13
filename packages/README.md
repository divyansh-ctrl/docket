# Shared packages

This directory is reserved for reusable runtime and UI contracts. No shared
production package is implemented here yet; the dashboard remains a standalone
prototype under `apps/dashboard`.

## Extraction rule

Create a package only when code has a stable contract and either two real
consumers or a clear security/ownership boundary. Do not move app-specific code
here solely to make the tree look modular.

Likely future boundaries include work-unit contracts, receipt schemas, policy
evaluation, provider adapters, sandbox clients, and telemetry conventions.
These are candidates, not committed package names or implemented features.

## Package requirements

Every package must provide:

- a lowercase kebab-case directory and package name;
- a focused `README.md` describing public API, owner, stability, and consumers;
- an explicit export surface rather than deep imports;
- unit tests and deterministic type/lint/build commands;
- no application entry points, embedded credentials, or hidden network effects;
- a documented versioning and compatibility policy before external release.

Shared packages may depend on other shared packages through an acyclic,
documented graph. They must not import from `apps/` or `infra/`.

