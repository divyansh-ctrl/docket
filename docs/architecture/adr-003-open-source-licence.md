# ADR-003: Apache-2.0, and what that decides

**Status:** accepted
**Date:** 2026-08-15

## Context

Two documents in this repository asserted opposite things about how Docket is licensed and sold.

[`PRODUCT.md`](../PRODUCT.md) carried a business-model table with an open-source Community edition, a hosted Team tier, a self-hosted Enterprise tier, and managed inference — labelled a hypothesis, but the only statement in the repository on the question.

[`differentiation-thesis.md`](../research/differentiation-thesis.md) assumed the opposite throughout: proprietary, closed-source, local-first, no backend. Its §4.3 treated near-zero organic discovery as a consequence to answer for, and §4.1 treated an unsigned binary as a contradiction to pay to fix.

The disagreement was recorded rather than resolved when the thesis was reconciled on 2026-08-15, because it is a product decision. It blocked more than it appeared to:

- **Signing.** A Developer ID certificate requires the paid Apple Developer Program at $99/year, and there is no free path to one. Whether that is a necessary purchase or an optional convenience depends entirely on how the software is distributed.
- **Discovery.** Every competitor reviewed is vendor-signed and first-party, or open-source and self-built. Docket was neither.
- **The signing contradiction.** Asking a developer to right-click past Gatekeeper on an unsigned binary that will hold their repository and shell out to their credentialed CLI, while selling them a product whose thesis is trust and evidence, is a contradiction that no amount of documentation resolves.

## Decision

**Docket is open source under Apache-2.0.**

Apache-2.0 rather than MIT for the explicit patent grant and its contributor patent-retaliation clause, which are worth having if commercial offerings ever appear alongside the project. Apache-2.0 rather than AGPL-3.0 because Docket is a local desktop application: the network-service clause that gives AGPL its protection would almost never trigger here, so it would impose real adoption cost in exchange for largely theoretical benefit.

The research in `docs/research/` is published with the code, including the competitive teardowns and the "where we are weakest" section that says plainly that the product is unsigned and that its thesis was, at the time of writing, unbuilt.

## Consequences

### What this settles

- **Distribution has a free path.** Building from source and installing through Homebrew both avoid the quarantine attribute that triggers Gatekeeper, so an unsigned build stops being a blocker and becomes an inconvenience. Signing remains worth doing and is no longer load-bearing.
- **The business-model table in `PRODUCT.md` is withdrawn**, not amended. It described tiers that presume a hosted control plane, and it was never customer-validated. Any future commercial offering is a separate decision to be recorded in its own ADR rather than inherited from a table nobody agreed to.
- **The discovery problem in the thesis §4.3 is answered.** A public repository under a recognised licence is the discovery mechanism the category actually uses.

### What this costs

- **A fork can take the code.** This is the deliberate trade. The competitive research already concluded that the wedge is the evidence packet and the taste behind it, not the orchestration, and that a well-resourced competitor could add a sandbox faster than we could add distribution.
- **The research becomes readable by the products it discusses.** Competitor pricing and capability claims in it are labelled with their review date and `[assumption]` where unverified, which is the standard they were written to. Publishing them unchanged is consistent with the product's own argument that stated uncertainty beats implied confidence.
- **Contributions arrive with expectations.** Issues, pull requests, and licence questions become real work that nothing currently budgets for.

### What this does not decide

- Whether a paid tier ever exists, and if so what is in it.
- Whether the repository accepts external contributions, and under what agreement.
- Whether to still buy a Developer ID certificate. It is now optional rather than blocking, and remains the difference between a download that works and one that needs an explanation.
