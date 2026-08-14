# Guildly teardown

**Research date:** 2026-08-13  
**Subject:** [Guildly](https://www.tryguildly.com)  
**Method:** public website and documentation review, public release repository, supplied product screenshot, and limited public commentary. No private account or source code was inspected.

## Executive view

Guildly presents a coherent desktop workspace for managing a small AI software team. Its strongest idea is not “multiple agents”; it is giving planning, implementation, review, and human intervention one persistent place. The product material reviewed shows a polished coordination layer over Claude Code with local project state, Git branches, team roles, connections, and explicit review gates.

Docket should preserve the useful coordination patterns while changing the center of gravity from **who is busy** to **which outcome is safe to accept**. It should not clone Guildly's visual identity, agent names, or virtual-office metaphor.

## Verified product facts

The following statements are directly supported by Guildly's public material as reviewed on the date above.

| Area | What the public material says | Source |
|---|---|---|
| Form factor | Guildly is a desktop application offered for macOS, Windows, and Linux. | [Homepage](https://www.tryguildly.com), [getting started](https://www.tryguildly.com/docs/getting-started) |
| Team shape | A workspace can include a manager, PM, engineering roles, and reviewer, and the hiring flow supports additional custom agents. | [Your team](https://www.tryguildly.com/docs/your-team), [hiring](https://www.tryguildly.com/docs/hiring) |
| Agent runtime | The documentation says agents run on Claude Code and use the customer's Claude subscription. | [Getting started](https://www.tryguildly.com/docs/getting-started), [settings](https://www.tryguildly.com/docs/settings-and-shortcuts) |
| Data posture | Guildly says messages and files remain on the user's computer rather than a Guildly cloud, while prompts used by the agent are sent to Anthropic. | [Privacy](https://www.tryguildly.com/privacy) |
| Collaboration | Users can send requests in channels and threads, create tickets and PRDs, use approvals, and coordinate work across roles. | [First request](https://www.tryguildly.com/docs/your-first-request), [documentation index](https://www.tryguildly.com/docs) |
| Integrations | Connections are provided through Composio and can be assigned to agents. | [Connections](https://www.tryguildly.com/docs/connections) |
| Model choice | The documentation describes selecting models per agent and recommends stronger models for thinking and cheaper models for typing-oriented work. | [Settings](https://www.tryguildly.com/docs/settings-and-shortcuts), [best practices](https://www.tryguildly.com/docs/best-practices) |
| Change isolation | Agent work is described as occurring in a “sandbox,” implemented as a Git branch, followed by review and promotion. | [How work ships](https://www.tryguildly.com/docs/how-work-ships) |
| Human control | The activity experience exposes interrupt and stop controls; review and approval remain part of the delivery flow. | [How work ships](https://www.tryguildly.com/docs/how-work-ships), supplied Activity screenshot |
| Cost controls | Documentation describes autopilot, usage controls, and model choices intended to manage subscription usage. | [Best practices](https://www.tryguildly.com/docs/best-practices), [settings](https://www.tryguildly.com/docs/settings-and-shortcuts) |
| Distribution | A public repository distributes desktop releases. It should not be mistaken for the application source repository. | [Guildly releases](https://github.com/shoebum-goyell/guildly-releases/releases) |

## What Guildly gets right

### One place for the delivery loop

Channels, tickets, PRDs, code execution, review, and human approvals are adjacent. This is materially more useful than forcing a user to reconstruct agent state across terminal tabs and chat transcripts.

### Explicit roles and handoffs

Named roles make delegation legible to non-experts. A manager-to-implementer-to-reviewer path supplies a mental model that feels familiar even when the underlying agents are new.

### Visible intervention

The supplied Activity screenshot makes waiting, blocked, idle, interrupt, and stop states visible. This is an important trust pattern: a user can see that a run needs them and has an obvious way to intervene.

### Local workspace orientation

Keeping project coordination state on the desktop can be attractive to teams wary of another hosted system. The public privacy page is unusually direct about the distinction between local Guildly state and prompts sent to Anthropic.

### Review is a first-class stage

The documented reviewer and promotion flow recognizes that generated changes should not simply land because an agent finished producing them.

## Limits and opportunities

This section separates **verified observations** from **Docket product inferences**.

### Model choice is visible but appears operator-driven

- **Verified:** Guildly documents choosing models per agent and gives guidance about using stronger or cheaper models for different roles.
- **Inference:** static role-to-model selection places optimization work on the user and does not prove that the selected model is capable on a particular repository, server, or task.
- **Docket opportunity:** certify model/end-point pairs, route each bounded work unit by policy and outcomes, and show rejected candidates plus the route reason.

### The documented sandbox is a branch

- **Verified:** Guildly's shipping documentation describes its sandbox as a Git branch.
- **Inference:** a branch isolates change history but does not restrict process filesystem access, network egress, credentials, CPU, or memory.
- **Docket opportunity:** retain worktrees for merge hygiene but add process/container or microVM isolation, default-deny egress, scoped credentials, and external receipts.

### The interface emphasizes agent activity

- **Verified:** the supplied screenshot devotes persistent space to agent identities, online/blocked status, an activity timeline, and a workshop overview.
- **Inference:** as parallelism grows, an activity-first view can make a reviewer watch the system rather than decide what matters.
- **Docket opportunity:** make human-attention items, risk, validation evidence, and work-unit ownership the default. Keep raw traces as drill-down material.

### Shared context needs boundaries

- **Verified:** Guildly promotes shared team context and recommends one thread per topic so agents do not lose track ([best practices](https://www.tryguildly.com/docs/best-practices)).
- **Inference:** the thread recommendation reflects a general context-isolation problem. A universal shared memory can increase irrelevant context, cost, and data exposure.
- **Docket opportunity:** create minimal, typed context packets with lineage, retention rules, and explicit consumers.

### Provider and runtime portability are strategic

- **Verified:** the reviewed documentation presents Claude Code and Anthropic as the agent execution path.
- **Unknown:** the public pages inspected do not establish whether other runtimes are planned or privately supported.
- **Docket opportunity:** make the orchestration kernel host-neutral and treat OpenAI-compatible, `llama.cpp`, vLLM, and other adapters as replaceable edges.

### Review needs evidence, not another persona

- **Verified:** Guildly assigns a reviewer role and includes human review in the shipping flow.
- **Inference:** a second model saying “looks good” does not provide independent evidence unless model selection, context, tools, and checks are inspectable.
- **Docket opportunity:** deterministic verification first, then an independently routed reviewer when risk warrants it, followed by a receipt and focused human questions.

## Interface analysis from the supplied reference

### Useful patterns to retain

- persistent workspace navigation;
- a concise list of currently relevant workers or work units;
- a detailed execution timeline for the selected item;
- visible blocked and waiting states;
- immediate interrupt and stop controls;
- an ambient fleet overview that does not require changing pages.

### Patterns to transform

| Guildly reference pattern | Docket interpretation |
|---|---|
| agent persona as the main row | work unit with owner, model, data locality, risk, budget, and acceptance state |
| chronological activity as the main content | evidence timeline grouped into plan, effects, checks, review, and decisions |
| virtual-office overview | fleet health and certification status |
| generic “waiting on you” | exact decision, consequence, deadline, and recommended evidence |
| model attached to a persistent role | model selected per work unit, with route reason and fallback history |
| status color | text label, cause, elapsed time, and accessible color reinforcement |

### Visual direction

The Docket dashboard should be original: dense enough for operators, calm enough for reviewers, and explicit that prototype data is simulated. It can use the reference's effective three-part information architecture without copying its typography, palette, icons, agent names, or decorative office scene.

## Public commentary caveat

A Hacker News discussion associated with an earlier Guildly presentation included criticism of busy visual hierarchy and generic AI-product language. This is anecdotal feedback about a prior presentation, not a usability study of the current product and not representative of Guildly's customers. It is useful only as a reminder to prefer specific evidence and quiet hierarchy over theatrical autonomy.

## Strategic conclusion

Guildly validates demand for a human-readable team layer around coding agents. Competing by adding open-weight models to the same role-based interface would be insufficient. Docket must make routing, durable execution, isolation, verification, receipts, and review compression one coherent control system. Its promise should be fewer uncertain decisions per accepted outcome—not more agents on screen.

## Research constraints

- The assessment covers public material available on the research date, not private features or future plans.
- No production task was run in Guildly, so performance and reliability were not benchmarked.
- The supplied screenshot was used only as a design reference.
- An Adaptive Model Router delegation was attempted during the broader discovery process but its transport was unavailable; no external worker-model result is claimed in this teardown.
