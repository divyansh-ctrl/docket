# Infrastructure

This directory is reserved for versioned deployment, isolation, observability,
and environment configuration. No production infrastructure is implemented
here yet.

## Intended boundaries

Future additions may include:

- `environments/` for reviewed, non-secret environment overlays;
- `deployment/` for control-plane and dashboard deployment definitions;
- `isolation/` for container or microVM profiles, network policy, and resource
  limits;
- `observability/` for OpenTelemetry collectors, dashboards, and alerts;
- `development/` for reproducible local dependencies that do not contain
  credentials.

These names describe planned organization only; empty scaffolding should not be
added until an implementation needs it.

## Guardrails

- Never commit credentials, private keys, provider tokens, state files, or
  unredacted environment dumps.
- Keep secret values in an approved secret manager and reference them by stable
  identifiers from versioned configuration.
- Default worker network access to denied, then allow only reviewed destinations
  required by the work-unit policy.
- Separate control-plane authority and append-only receipt storage from
  agent-writable workspaces.
- Pin and verify deployable artifacts. Record rollback and migration procedures
  beside the configuration they govern.
- Infrastructure changes require formatting, static validation, policy checks,
  and an environment-specific plan before apply.

## Naming

Use lowercase kebab-case for directories and human-authored files. Preserve
tool-required filenames when a selected infrastructure tool defines them.

