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

> **Amendment 2026-08-18 — the checkpoint fired, and the diagnosis was in the
> pose, not the rig.**
>
> Reported after Phase 2 landed: *"i see few agents just moving their hands"*.
> That was literally true. In the seated pose the arms and the head were the
> only fields that were functions of time; the hip, the torso, the thighs and
> the knees were constants, and the arm term was one 9Hz sine — a metronome.
> A figure whose only moving part vibrates reads as a toy with one moving
> part, which is exactly what was reported.
>
> Two things were missing and both are now in:
>
> - **A waist.** The body group's origin is on the floor, so rotating it
>   leaned the whole figure over like a felled tree — there was no pivot at
>   which a lean could happen, so no lean was ever written. Everything above
>   the hip now hangs off a `chest` group at hip height.
> - **Idle life on a long period.** Breath, weight shifting between hips, a
>   forward lean at the keyboard and back to read, a foot tucking under the
>   chair, glances away from the screen — every one a function of time, none
>   on a period short enough to read as a loop.
>
> Typing is now a **burst**: about five seconds on, four off, phase-offset per
> agent so the floor never types in unison. The burst is the shape of the
> animation rather than a decoration on it.
>
> The regression is guarded directly: `a seated agent moves more than its
> hands` samples the pose over twenty-four seconds and fails if the hip,
> torso, twist, head or knees are still. Run against the old pose it reports
> five fields moving 0.000 — the complaint, reproduced as an assertion.
>
> One recorded contract was corrected rather than worked around: the knee
> stop moved from π/2 to 2.45 rad. A knee flexes to about 140°, not 90; the
> square limit was a conservative stand-in written when no pose approached
> it, and tucking a seated foot back under a chair genuinely needs past
> square. **Fallback C was not taken** — the figures read as people at a desk
> once the torso moved, so the sprite swap stays unused.

### Phase 3 — The room reads at every zoom

- Camera stops: gentle collision easing near walls instead of a hard clamp.
- Level-of-detail for text: name tags always; intent lines only under a
  distance threshold; bubbles always (they are the point).
- Instance the repeated meshes (pendants, plants, chairs) — one draw call
  per kind. Budget: < 120 draw calls, 60fps on the Air this runs on, pixel
  ratio clamped at 2.
- Theme: the pastel daylight / warm evening palettes stay; both must pass the
  same visual checklist (below).

> **Amendment 2026-08-18 — done, and the draw-call budget was wrong.**
>
> Shipped: soft camera limits (`easeDistance`, `clampLookAt`,
> `liftAboveFloor` in `office-scene.ts`), label level-of-detail
> (`labelDetail`), instanced props, a toned-down decor pass, and the palettes
> moved into the pure module so the suite can parse them — which is the
> answer to D7. Nine new invariants cover all of it.
>
> **The budget of 120 draw calls was written without counting the people.**
> Measured on this machine, in the dark theme, at the default framing:
> **295 draw calls, 60fps median (16.7ms)**. Roughly 190 of those 295 are the
> nine figures — each is a hierarchy of about twenty-one separately drawn
> boxes, and an articulated figure cannot be instanced with the others
> because every joint angle differs. The props, which the budget was really
> about, now cost about 105 for the entire room; instancing removed about 82.
>
> So the number in the budget is met by the part of the scene it was aimed
> at, and missed by two and a half times overall. The right response is to
> record the measurement rather than to quietly restate the target: 295 at a
> steady 60fps is not a problem to solve, and the frame-time figure is the
> one worth holding. **Revised budget: 60fps median frame time, measured; a
> draw-call count reported on every office open so the next prop added is
> visible in the log rather than discovered later.**
>
> Two further defects were found by looking rather than by reasoning:
>
> - **D8 — the overlay labels had no CSS whatsoever.** `data-visible="false"`
>   hid nothing, so tags for agents behind the camera stayed on screen at a
>   stale position; and each tag was a static block that flowed down the
>   overlay before its transform applied, so every name after the first was
>   drawn a line further from the head it belonged to. Fixed in `styles.css`.
>
> - **D9 — zoom-to-cursor bottomed out on the floor.** The orbit target was
>   free to be dragged anywhere, and the gaps between pods are bare floor, so
>   zooming in on a gap ended nose-first on a floorboard with the desks above
>   the horizon. The look-at point and the camera are both now held at
>   working height rather than floor height.
>
> Verified in the browser preview, dark theme: tags positioned and thinning
> with distance, zoom reaching one desk and stopping usefully, 60fps. **The
> light theme was not rendered this session** — the preview pane's scaling
> broke when the colour scheme was switched, and the palette test is what
> stands behind the light theme for now, not a screenshot.

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

> **Amendment 2026-08-18 — done, and the shell had the same defect the
> geometry did.**
>
> The bullets above assumed the shell's problem was polish. It was not. The
> zone list — every stage's id, its name, its one-line note — and the
> `Presence` and `Zone` types were **written out twice**, identically, in
> `office.tsx` and in `office-scene.ts`: two lists that happened to agree,
> with nothing keeping them agreeing. That is precisely the defect the seats
> had before they were derived from the desks (D1), one layer up, and it
> would have shipped the moment somebody renamed a stage in one file. There
> is now one list; the plan view adds only the rectangles the scene module
> has no opinion about.
>
> What shipped:
>
> - **The pipeline as a strip.** Every stage, *including the empty ones* —
>   an empty test lab beside a crowded review bench is the fact the floor
>   exists to show, and a strip that drops its zeroes hides exactly that.
>   Pressing one frames the camera there, which finally connects the scene's
>   `focus` prop; it had been hardcoded to `{zone: null, nonce: 0}` since it
>   was written, so the re-framing code was live but unreachable.
> - **Selection binds the rail to the floor.** The card you picked and the
>   figure it names now carry the same ring in the same tone. Selection
>   outranks hover, and waiting-on-you amber outranks both, because that one
>   is a fact about you and must not be dimmed by whatever is selected.
> - **The derivations moved out of the view** into `office-shell.ts` —
>   `statusOf`, `tallyZones`, `describeFloor` — where the suite can reach
>   them. Five invariants, the sharpest being that an agent who is both
>   waiting on you and blocked is counted **once**, under the heading that is
>   your move; otherwise a floor of three reads as a floor of five.
> - **The modal became a modal.** It carried `role="dialog"
>   aria-modal="true"` and honoured neither: Escape did nothing and focus
>   stayed on whatever opened it, so the first Tab went into the page behind.
> - **Reduced motion** reaches the canvas, which a stylesheet cannot: the
>   poses freeze at a settled posture, the camera snaps to a framing instead
>   of easing to it, the waiting marker stops bobbing, and the demonstration
>   wander does not run. Figures are still *posed* — seated people sit — the
>   pose being information about state and only the animation decoration.
>
> Not done, and deliberately: the **context meter still reads "not
> measured"** in the desk panel and does not appear on the rail at all.
> Nothing counts tokens yet, and the rail showing a number nobody counted is
> the exact failure this product exists to remove. The Terminal and Git tabs
> keep their honest-empty text for the same reason.
>
> **Amendment 2026-08-18:** the meter is now measured — see
> [token-accounting.md](token-accounting.md). It reads the CLI's own
> transcript and reports the session's real figures. **The rail still shows
> no per-agent number**, and that has not changed for the reason it never
> could: the transcripts carry no per-subagent attribution, so a per-agent
> figure would be arithmetic on an assumption. The desk panel says whose
> figure it is instead.
>
> Verified through the DOM in the browser preview: the strip carries the
> right counts with empty stages kept, framing and selection both take, the
> selected card wears the agent's tone (`--tone-lead` measured on the
> element, not assumed), focus lands inside the dialog on open, and Escape
> closes it. **Reduced motion was not exercised** — the preference cannot be
> toggled from the preview — so it is implemented and unproven, and recorded
> as a row in the checklist rather than claimed.

### Phase 5 — Verification that survives the next change

- The Phase 0/2 invariant and pose tests in CI (pure node, no GPU).
- A manual visual checklist committed alongside the plan: both themes ×
  {default framing, full zoom-in at a pod, full zoom-out, 180° orbit, one
  agent walking, one seated, fallback plan view} — walked before any office
  PR merges, because a scene renderer cannot cheaply screenshot-diff in CI
  and pretending otherwise would be a test that tests nothing.

> **Amendment 2026-08-18:** the checklist now exists, at
> [office-visual-checklist.md](office-visual-checklist.md), with a table of
> recorded walks at the bottom. The first walk is recorded there, including
> the rows it did not cover.

> **Amendment 2026-08-18 — done, and two of the rows could not be walked as
> written.**
>
> **The invariants in CI: already true, and now confirmed by evidence rather
> than by reading the config.** `npm test` runs on macOS, Ubuntu and Windows,
> and the Ubuntu log for the Phase 4 run carries `ok 182 - a seated agent
> moves more than its hands`, `ok 189 - every colour in both palettes is a
> colour` and `ok 190 - status ranks by what a reviewer must not miss`. Pure
> node, no GPU, on a headless runner.
>
> **"Walked before any office PR merges" was a wish, and is now a gate.**
> `scripts/office-walk.ts` fails a pull request that changes the room without
> the checklist's recorded-walks table gaining a row. It is honest about its
> own limit, in its header and here: it cannot tell whether the walk
> happened. A row saying "walked, fine" passes it. That is not the failure it
> is built for — it is built for the ordinary one, where a small office
> change goes in with a green suite and nobody remembers there was a
> checklist. Seven tests cover the gate itself, including that the shared
> stylesheet only trips it when the office's own rules changed, since a gate
> that cries wolf gets satisfied with junk rows.
>
> **The first walk in the packaged app found the checklist wrong, not the
> room.** Rows 6 and 7 ask you to watch a *seated* agent for thirty seconds.
> With no session running the floor is in demonstration mode, which relocates
> an agent every 3.2 seconds — so nobody stays seated, and the row is not a
> strict test but an impossible one. A row that cannot pass is a row that
> gets skipped and then forgotten. The checklist now says to walk those two
> with a session running.
>
> Row 16 needs the OS reduced-motion preference turned on. That is a change
> to the machine's settings, which Claude does not make, so an automated walk
> will always leave row 16 unwalked and must say so rather than pass it. It
> is marked as a row for a person.
>
> Also worth recording, because it nearly produced a false result: the first
> attempt at this walk opened `/Applications/Docket.app` — an installed build
> from earlier that day — because `open` activates a running instance rather
> than launching the binary you named. The office it showed was the old flat
> plan surface, not the room this plan is about. The walk was redone against
> the packaged binary directly. **A visual check against the wrong build is
> worse than no visual check**, because it produces a confident answer.
>
> Not done: the light theme is still unwalked, and rows 3, 5, 11 and 12 with
> it. They are listed as outstanding in the checklist rather than quietly
> dropped.

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
