# Architecture index

These documents define the proposed production boundaries behind the dashboard
prototype. Unless a document explicitly says otherwise, they describe intended
behavior rather than a completed runtime.

## Recommended reading order

1. [`adr-001-routing-boundary.md`](adr-001-routing-boundary.md) — accepted
   boundary between a host agent, the Docket control plane, delegated workers, and
   enforced provider traffic.
2. [`adr-002-desktop-runtime.md`](adr-002-desktop-runtime.md) — accepted
   desktop runtime, controller, PTY, authentication, and packaging boundary.
3. [`adr-003-open-source-licence.md`](adr-003-open-source-licence.md) — accepted
   Apache-2.0 licence, what it settles about distribution and signing, and what
   it deliberately leaves open.
4. [`system.md`](system.md) — end-to-end components, work-unit lifecycle, and
   durable orchestration model.
5. [`security.md`](security.md) — isolation, authorization, network, credential,
   audit, and threat-model requirements.
6. [`model-fleet.md`](model-fleet.md) — open-weight terminology, endpoint
   certification, serving options, and routing policy.
7. [`receipts.md`](receipts.md) — evidence schema and the distinction between a
   configured, requested, routed, and provider-reported model.

## Authority and change control

- An ADR records a decision and its trade-offs. Supersede a decision with a new
  sequential ADR; do not silently change its historical outcome.
- System documents describe the current proposed design. They must remain
  consistent with accepted ADRs and should link to the controlling ADR when a
  boundary is involved.
- Security requirements are release gates, not optional implementation notes.
  Changes affecting credentials, isolation, authorization, audit integrity,
  concurrency, or migrations require independent review and focused tests.
- Dashboard labels are product truth contracts: simulated, planned, connected,
  executed, verified, and approved states must never be conflated.

## Naming and additions

Use lowercase kebab-case for new architecture documents. ADRs use
`adr-NNN-short-decision.md` with a zero-padded sequence. Add every new document
to this index and record its status, date, owner, and validation evidence where
applicable.
