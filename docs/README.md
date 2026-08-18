# Documentation index

This directory is the entry point for product, architecture, delivery, and
research decisions. Documents distinguish verified facts from inferences and
proposals so the prototype never implies that unbuilt runtime behavior exists.

## Start here

| Question | Document |
|---|---|
| What is Docket and who is it for? | [`PRODUCT.md`](PRODUCT.md) |
| What is planned, and what proves each phase? | [`ROADMAP.md`](ROADMAP.md) |
| What gets built next, and in what order? | [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) |
| How does the Office become good? | [`office-implementation-plan.md`](office-implementation-plan.md) |
| What must the Office look like before an office PR merges? | [`office-visual-checklist.md`](office-visual-checklist.md) |
| Does the gate actually catch a lying agent? | [`divergence-demonstration.md`](divergence-demonstration.md) |
| How is the repository organized? | [`PROJECT-STRUCTURE.md`](PROJECT-STRUCTURE.md) |
| How should the production system work? | [`architecture/README.md`](architecture/README.md) |
| What evidence informed the product? | [`research/README.md`](research/README.md) |
| What rules guide the dashboard UI? | [`../design-system/docket/MASTER.md`](../design-system/docket/MASTER.md) |

## Documentation areas

- [`architecture/`](architecture/) contains system boundaries, accepted
  decisions, security requirements, model-fleet policy, and receipt contracts.
- [`research/`](research/) contains dated product and market research, supplied
  references, and routing audit artifacts.
- `PRODUCT.md` and `ROADMAP.md` are stable top-level entry points. Their
  uppercase names predate the kebab-case convention and remain unchanged so
  existing links do not break.

## Authoring rules

1. Use lowercase kebab-case for new human-authored documents. Use the existing
   uppercase entry-point names only for the stable exceptions listed above.
2. Add a status and review date when facts or recommendations can age.
3. Link verified product claims to primary sources. Label user reports and
   competitive gaps as evidence, inference, or hypothesis as appropriate.
4. Record accepted cross-cutting decisions as sequential ADRs in
   `architecture/`; do not rewrite historical decisions without a superseding
   ADR.
5. Update the nearest index whenever a document is added, renamed, superseded,
   or removed.
6. Keep credentials, customer data, and environment dumps out of documentation
   and routing receipts.

