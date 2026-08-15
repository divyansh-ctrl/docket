# Desktop shell page override

> **Project:** Docket  
> **Surface:** Downloadable desktop workbench  
> **Updated:** 2026-08-13

These rules override `../MASTER.md` for the Electron desktop application.

## Product posture

- Present Docket as an evidence-first coding-agent control room, not an IDE clone
  or a virtual-office game.
- The selected **controller** is Codex or Claude Code. Routed worker models are
  separate, bounded delegates and must never be presented as replacing the
  controller.
- The Workshop office metaphor represents durable workflow stages. Pods are
  missions, not people, and move only after recorded stage events.
- Label browser-preview and simulated data persistently. Never present planned
  workers, receipts, authentication, or CLI activity as real.

## Layout

- Minimum supported window: `960 × 640`; primary design target: `1280 × 800`.
- Use a discoverable labelled rail, workspace/controller header, mission
  explorer, central Ledger or Workshop canvas, optional trust inspector, and a
  purpose-bound bottom console.
- Below 1180px, move secondary panels into accessible drawers instead of
  shrinking controls below usable sizes.
- The login console is resizable from 220–560px and never leaves less than
  240px for the primary canvas.

## Visual language

- Keep matte, border-led surfaces, restrained shadow depth, Fira Sans UI text,
  and Fira Code for commands, paths, receipts, and tabular figures.
- Appearance (`System`, `Light`, `Dark`) is independent from atmosphere
  (`Violet Ink`, `Mineral Blue`, `Warm Sand`). Atmosphere may tint surfaces and
  focus accents but never changes success, warning, error, or information
  semantics.
- Use Lucide outline icons with consistent stroke weight. No emoji structural
  icons, decorative gradients, glass blobs, avatars, or ornamental activity.

## Motion

| Token | Duration | Use |
|---|---:|---|
| Feedback | 90ms | Press, hover, focus acknowledgement |
| Fast | 140ms | Tooltips, menu exits, content crossfade out |
| Normal | 220ms | Drawers, palette, content crossfade in |
| Spatial | 320ms | A mission moving between Workshop rooms |

- Animate only transform and opacity. Animations must be interruptible and
  never block input.
- Do not animate terminal line arrival or run continuous decorative motion.
- Under `prefers-reduced-motion: reduce`, collapse durations to 1ms and replace
  spatial movement with immediate text/icon state changes.

## Interaction and accessibility

- Every primary target is at least 44 × 44px with a visible 2px focus ring.
- Provider choice uses an accessible radio group. Tabs, menus, dialogs,
  resizers, and command palette follow their established keyboard patterns.
- Provider, login, and run state always include text and icon cues; color alone
  never communicates state.
- Announce authentication and high-level run state in live regions. Do not
  stream every terminal line to assistive technology.
- The embedded terminal is visibly labelled `Restricted login session` and
  exposes fixed provider commands only. A general shell is outside the MVP.

## Controller safety

- Both providers may be detected and authenticated, but a workspace has one
  selected controller.
- Never hot-swap, restart, attach to, or continue an existing provider session.
  A controller change applies to a new session and requires an idle state or an
  explicit stop/checkpoint decision.
- Renderer UI must never receive credentials, environment secrets, raw process
  handles, or arbitrary command execution capability.

## QA matrix

- Validate at `960 × 640`, `1280 × 800`, and `1440 × 900`.
- Validate System/Light/Dark, all three atmospheres, reduced motion, keyboard
  navigation, 200% zoom, and terminal focus/copy/input behavior.
- Verify no content hides under title-bar chrome or the console, no horizontal
  overflow, and no false claim survives browser-preview mode.
