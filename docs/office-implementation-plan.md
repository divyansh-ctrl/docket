# The Office: end-to-end implementation plan

**Status:** proposed
**Date:** 2026-08-18

The Office is the home surface — the decision recorded earlier stands: the
office is where you watch and direct agents, and the Case File dossier is where
you decide. This plan is about making the office *good*: the figures are
malformed, the screens face the wrong way, sitting looks broken, and the UI
around the floor is a first pass. It covers repair versus rebuild, and it is
written from diagnosis of the actual code, not from impressions.

Reference direction remains the recorded video (`scratchpad/reference-ui.md`
in the session that produced this): a chill room, agent cards in a rail, a
desk panel with tabs and a queue, ambient motion. Its Dunder-Mifflin skin is
not copied; its interaction design is.

## Part 1 — Why the figures look wrong: the defect catalog

Every entry below was found by reading `office-3d.tsx` / `office-scene.ts`
and confirmed against the running scene. File references are to
`apps/desktop/src/renderer/`.

**D1 — Seats detach from furniture under rotation.** `office-scene.ts`
derives each desk seat as `{ x: desk.x, z: desk.z + 0.95 }` — a world-space
offset that is only correct when the desk's heading is exactly π. The moment
desks were angled into pods, every chair moved with its desk group but every
*seat* stayed on the old axis. Figures now sit on air, at the wrong angle,
intersecting the rotated furniture. The comment above the table claims seats
are "derived from the furniture, so a seat cannot end up somewhere there is
nothing to sit at" — the derivation silently assumed one fixed heading, and
the pod change broke it. This is the main source of "malformed and twisted".

**D2 — Screens face away from the people at them.** In the desk group
(`office-3d.tsx`, desk build): chair at local z **−0.95**, keyboard at
**+0.1**, monitor body at **−0.26** with the emissive glass at **−0.23** —
i.e. on the **+z** face. The screen and the keyboard both face the empty side
of the desk; the sitter looks at the monitor's metal back. This predates every
recent change — it has been true since the scene was written, and it is the
"screens are inverted" observation.

**D3 — No knees.** A leg is one box hinged at the hip. Sitting rotates it
−π/2: a rigid 0.84-long beam swings horizontal and spears through the desk,
because there is no shin to fold down. Same for arms — no elbows, so the
typing pose is a shoulder rotation with hands floating.

**D4 — The sit drop is a constant that disagrees with the chair.** Sitting
sets `body.position.y = −0.4`, landing the hip at 0.46 while the chair pan's
top is at 0.485. Combined with D1's misplacement the figure clips or floats
depending on angle.

**D5 — Non-desk seat headings are hardcoded.** Review, lab, waiting, shipped
seats carry `heading: Math.PI` or `0` literals, unrelated to the furniture
they belong to. Rotate or move a bench and its sitters will not follow — the
same class of bug as D1, currently latent.

**D6 — Overflow standing spots ignore furniture.** `seatFor`'s fallback grid
spreads standees uniformly across a zone rect. Zone rects contain desks, so a
seventh agent in the desk zone stands inside a desk.

**D7 — One palette drove it all and carried corruption.** The light palette
shipped `ground: "#b9a headers"` — an invalid colour, live since the scene
was written (now fixed). It is worth recording because it says something the
plan must answer: nothing validates this scene. No test can currently fail on
any of D1–D6.

## Part 2 — Repair, rebuild flat, or hybrid

Three directions were considered end to end.

**A. Repair the low-poly 3D (recommended).** Keep the Three.js room, fix the
geometry contracts, give the rig knees and elbows. The 360 orbit, cursor zoom,
walking, DOM-projected text, and WebGL fallback all exist and were asked for
by name; a flat rebuild throws away the only feature of this surface the user
has specifically shaped ("make it 360", "zoom to the corner"). The risk is
art: low-poly humanoids are the hardest asset in the scene to make charming
without an artist. The mitigation is that every named defect is a *geometry
contract* bug, not an art bug — fixable with maths and tests, not taste.

**B. Rebuild as 2D pixel art (the reference's literal look).** Sprites cannot
be "twisted": a drawn character is correct by construction, which eliminates
D1–D4 as a class. But a top-down sprite floor kills the 360 orbit and the
zoom-to-cursor camera that were explicitly requested after the reference was
given — the user has been steering the 3D room, not away from it. Rebuild
cost is the whole surface, including everything that already works.

**C. Hybrid — 3D room, sprite people.** Billboarded sprite characters in the
3D room survive orbiting and remove the humanoid-rig risk. This is the named
fallback: if the figures still read uncanny after Phase 2, swap `makeFigure`
for billboards without touching the room, the camera, seats, or the UI shell.
The seat/screen contracts (Phase 1) are needed under every direction, so no
work below is wasted by taking the fallback.

**Decision asked of you:** proceed with A, holding C as the fallback. B only
if you would trade the 360 camera for the literal pixel look.

## Part 3 — Phases

### Phase 0 — Make the scene testable (blocking, small)

The office is the only subsystem in Docket where nothing can fail a test. The
geometry lives in `office-scene.ts`, which is pure and importable under
`node --test` — no WebGL needed.

- Export `chairOf(desk)`: chair world position + facing derived by rotating
  the local offset through the desk's heading.
- Invariant tests: every desk-zone seat coincides with its desk's chair
  (distance < ε) and faces the desk top; every seated seat in every zone has
  furniture registered at its position; overflow standing spots collide with
  no furniture footprint; every heading is finite and normalized.
- These tests must fail today (D1, D5, D6), then pass after Phase 1. A test
  that cannot fail on the present code is not the test to write.

*Done when:* `office-scene` invariants run in the suite, and the D1/D5/D6
failures are demonstrated before the fix lands.

### Phase 1 — One source of truth for furniture and seats

- Desks own their seats: `SEATS.desk` computed via `chairOf`, never by axis
  offset. Bench, couch, lab and intake furniture get the same treatment:
  furniture declares seat anchors; zones collect them; nothing is hand-synced.
- Fix D2 in the desk group: keyboard, screen glass and chair on the same
  side; the screen's emissive face toward the chair (dot-product asserted in
  Phase 0's tests).
- Overflow standees spread along zone *aisle margins* (computed clear strips)
  rather than the full rect.

*Done when:* all Phase 0 invariants green; rotating any desk or bench by any
angle moves its sitters correctly with zero other edits.

### Phase 2 — A rig that can sit

- Two-segment legs (thigh + shin, knee pivot) and elbows. Sitting becomes:
  hips to *chair pan height* (a shared constant with the chair build, not a
  magic −0.4), thighs −π/2, shins +π/2, feet flat. Typing bends elbows, not
  shoulders.
- Poses become named pure functions (`sitPose`, `standPose`, `walkPose(t)`)
  returning joint angles — unit-testable for range limits (no joint beyond
  its physical stop, ever) without rendering.
- Gait: keep the existing phase-driven swing, applied to knees as well so the
  walk stops being a stiff scissor.

*Done when:* a seated figure's hip rests on the pan, no limb intersects desk
or chair (asserted geometrically for the canonical desk at 8 headings), and
pose functions have range tests. **Checkpoint:** if figures still read wrong
here, take fallback C — the sprite swap — rather than polishing further.

### Phase 3 — The room reads at every zoom

- Camera stops: gentle collision easing near walls instead of a hard clamp.
- Level-of-detail for text: name tags always; intent lines only under a
  distance threshold; bubbles always (they are the point).
- Instance the repeated meshes (pendants, plants, chairs) — one draw call
  per kind. Budget: < 120 draw calls, 60fps on the Air this runs on, pixel
  ratio clamped at 2.
- Theme: the pastel daylight / warm evening palettes stay; both must pass the
  same visual checklist (below).

### Phase 4 — The UI shell (the "mainly the UI" ask)

The floor is one third of the surface. The shell around it is what makes it
usable, and it is currently a first pass.

- **Rail cards**: avatar in the agent's tone, name, model chip, status chip
  derived from presence, and the context meter *when it exists* — until token
  accounting is built the meter stays "not measured"; the rail never shows a
  number nobody counted. Selected card visibly bound to the selected figure
  (same tone ring on both).
- **Desk panel**: Terminal tab becomes real when per-agent sessions exist
  (separate track; the panel says so until then); Messages tab shows the
  agent's room history (already real); Git tab stays honest-empty until
  per-agent attribution exists. Queue box keeps its explicit "recorded, not
  delivered" behaviour until delivery is built.
- **Chrome**: the office keeps its playful interior, but the shell — bars,
  tabs, cards, sheet — uses the Case File tokens (`--paper`, `--ink`,
  `--rule`, spacing scale), so opening the office does not leave the design
  system. Focus rings on every interactive element; `prefers-reduced-motion`
  drops the wander timer and all bobbing.
- **Empty states**: every pane states *why* it is empty in one sentence, as
  the desk panel already does.

### Phase 5 — Verification that survives the next change

- The Phase 0/2 invariant and pose tests in CI (pure node, no GPU).
- A manual visual checklist committed alongside the plan: both themes ×
  {default framing, full zoom-in at a pod, full zoom-out, 180° orbit, one
  agent walking, one seated, fallback plan view} — walked before any office
  PR merges, because a scene renderer cannot cheaply screenshot-diff in CI
  and pretending otherwise would be a test that tests nothing.

## Part 4 — Rules that hold in every phase

- **Position is state.** Zones and seats mean what the pipeline means; demo
  wander exists only under the demonstration label; live mode moves people
  only on recorded events.
- **Nobody is given words.** Bubbles render only text an agent actually
  produced. Movement may be demonstrated; speech may not.
- **Text lives in the DOM**, never baked into the canvas.
- **The plan view is the floor's equal**, not an apology: every state
  reachable in 3D is readable in it, and WebGL absence falls back to it.
- **Determinism.** No `Math.random` in the scene; identical inputs render an
  identical room.

## Part 5 — Order and estimates

| Step | Size | Depends on |
|---|---|---|
| 0. Invariant tests (failing first) | S | — |
| 1. Furniture/seat unification + screen fix | M | 0 |
| 2. Rig v2 (knees, elbows, pose functions) | M | 1 |
| — checkpoint: fallback C decision | — | 2 |
| 3. Zoom polish, LOD, instancing | M | 1 |
| 4. UI shell | M–L | none (parallel) |
| 5. Visual checklist + CI wiring | S | 0 |

Steps 0–2 are the "malformed figures" fix and are sequential. Step 4 is
independent and can proceed in parallel. Nothing here blocks Track 1.2 (the
divergence case), which remains the product's next milestone and should not
wait for the office to be beautiful.
