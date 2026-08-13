# AOS dashboard

Interactive product prototype for the AOS evidence-first agent operations
workbench. It makes routing, validation, cost, risk, and human approvals visible
without implying that the host coding model has changed.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verify

```bash
npm run lint
npm test
```

The test command builds the vinext/Cloudflare bundle and verifies the
server-rendered workbench.

## Prototype scope

- responsive three-pane command center;
- synchronized **Ledger** and **Operational workshop** views; the workshop maps
  missions into Plan, Route, Build, Validate, Approve, and Ship rooms without
  personifying models as employees;
- three subtle atmosphere themes (Violet Ink, Mineral Blue, and Warm Sand)
  that preserve semantic status colors;
- selectable missions and routing modes;
- pause, resume, scoped stop, and approval interactions;
- explicit Controller versus provider-reported Worker identity;
- run ledger, compressed changes, evidence, budget, and fleet views;
- simulated data clearly labelled throughout the experience.

The workshop, themes, and all controls operate entirely on simulated product
state. A button labelled “Actual worker” means the example provider receipt in
the prototype, not a model invoked by this dashboard.

The dashboard contains no live model execution or provider integration yet. See
the project-level architecture documents for the production design.
