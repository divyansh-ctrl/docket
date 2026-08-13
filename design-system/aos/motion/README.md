# AOS motion studies

Manim scenes for the explainer motion used in the dashboard's onboarding and
empty states. Scene source is the deliverable here; rendered video is not
committed.

`aos_pipeline.py` animates the product thesis end to end: one request is
decomposed into bounded work units, each unit is routed to a model that earned
it and to an explicit placement, deterministic gates run, the results compress
into a single route receipt, and a human — never AOS — approves.

## Why these values are not free-floating

- Colours come from [`../MASTER.md`](../MASTER.md) (`#7C3AED` primary,
  `#6366F1` secondary, `#EC4899` accent).
- Stage names mirror the `stages` array in
  [`apps/dashboard/app/aos-dashboard.tsx`](../../../apps/dashboard/app/aos-dashboard.tsx).
  If the pipeline changes there, change `STAGES` here in the same commit.
- The receipt fields match the fields in
  [`docs/architecture/receipts.md`](../../../docs/architecture/receipts.md).

## Setup

Manim needs the Cairo and Pango system libraries in addition to the Python
package:

```bash
brew install cairo pango            # macOS
sudo apt-get install -y libcairo2-dev libpango1.0-dev   # Debian/Ubuntu
```

Then, in a virtual environment:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install manim
```

LaTeX is *not* required: the scene uses `Text` (Pango), not `Tex`.

Installing the Fira Sans and Fira Code families matches the dashboard exactly.
Without them Pango substitutes a similar face and the scene still renders.

## Render

```bash
manim -pql aos_pipeline.py MissionPipeline
```

For the embeddable asset, render at high resolution with a transparent
background so the clip sits on either the light or dark dashboard surface:

```bash
manim -qk -t aos_pipeline.py MissionPipeline
```

Output lands in `media/videos/aos_pipeline/`. `-t` produces a `.mov` with an
alpha channel; convert to `.webm` for the browser if the clip is embedded:

```bash
ffmpeg -i media/videos/aos_pipeline/2160p60/MissionPipeline.mov \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 32 MissionPipeline.webm
```

## Before embedding in the dashboard

The dashboard honours `prefers-reduced-motion`. Any embedded clip must be
gated on it — offer a static poster frame instead of autoplaying — and must
carry a text alternative, since the animation communicates the product model
rather than decoration.
