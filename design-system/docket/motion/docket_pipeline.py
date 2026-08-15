"""Motion study for the Docket dashboard: how one request becomes bounded,
routed, verified work.

This renders the explainer used in the dashboard's onboarding and empty
states. Colours and stage names are taken from the design system Master file
(`design-system/docket/MASTER.md`) and from the dashboard's own `stages` array,
so the animation and the product stay in step.

Render (see README.md in this directory for setup):

    manim -pql docket_pipeline.py MissionPipeline     # fast preview
    manim -qk -t docket_pipeline.py MissionPipeline   # 4K, transparent

`-t` renders a transparent background so the clip can sit on either the light
or the dark dashboard surface.
"""

from manim import (
    BOLD,
    DOWN,
    LEFT,
    RIGHT,
    UP,
    Arrow,
    Create,
    FadeIn,
    FadeOut,
    Line,
    RoundedRectangle,
    Scene,
    Text,
    Transform,
    VGroup,
    Write,
    config,
)

# Design system tokens -- design-system/docket/MASTER.md
PRIMARY = "#7C3AED"
SECONDARY = "#6366F1"
ACCENT = "#EC4899"
BACKGROUND = "#FAF5FF"
FOREGROUND = "#0F172A"
MUTED = "#F7F3FD"
BORDER = "#EFE7FC"
SUCCESS = "#16A34A"
WARNING = "#D97706"
FAINT = "#64748B"

# Installing Fira matches the dashboard exactly; Pango substitutes a similar
# face when it is absent, so the scene still renders on a bare machine.
FONT_BODY = "Fira Sans"
FONT_MONO = "Fira Code"

# The dashboard's own pipeline, kept identical to `stages` in docket-dashboard.tsx.
STAGES = ["Plan", "Route", "Execute", "Validate", "Approve", "Integrate"]

# Each unit carries the labels the product actually routes on: the kind of
# work, the model that earned it, and where that model is allowed to run.
WORK_UNITS = [
    ("Implement", "Qwen3 Coder Next", "Private GPU", PRIMARY),
    ("Tests", "gpt-oss 20B", "Local", SECONDARY),
    ("Docs", "Haiku 4.5", "Hosted", ACCENT),
]

config.background_color = BACKGROUND


def label(text: str, size: int, color: str = FOREGROUND, weight: str = "NORMAL") -> Text:
    return Text(text, font=FONT_BODY, font_size=size, color=color, weight=weight)


def mono(text: str, size: int, color: str = FOREGROUND) -> Text:
    return Text(text, font=FONT_MONO, font_size=size, color=color)


def card(width: float, height: float, fill: str = "#FFFFFF", stroke: str = BORDER) -> RoundedRectangle:
    return RoundedRectangle(
        corner_radius=0.12,
        width=width,
        height=height,
        fill_color=fill,
        fill_opacity=1.0,
        stroke_color=stroke,
        stroke_width=2.0,
    )


class MissionPipeline(Scene):
    """One request, decomposed and routed, arriving as reviewable evidence."""

    def construct(self) -> None:
        # Annotations are tracked so they can be cleared together when the
        # units collapse into the receipt.
        self.chips = VGroup()
        self.gates = VGroup()
        heading = self.show_heading()
        rail, nodes = self.show_stage_rail()
        request = self.show_request()
        units = self.decompose(request)
        self.route(units, nodes)
        self.verify(units, nodes)
        receipt = self.compress_to_receipt(units, nodes)
        self.approval_boundary(receipt, nodes)
        self.play(FadeOut(VGroup(heading, rail, receipt)), run_time=0.6)

    def show_heading(self) -> VGroup:
        title = label("One request. Bounded work. Verifiable evidence.", 30, FOREGROUND, BOLD)
        subtitle = label(
            "Docket decomposes, routes, and proves -- a human approves.", 20, FAINT
        )
        heading = VGroup(title, subtitle).arrange(DOWN, buff=0.16).to_edge(UP, buff=0.5)
        self.play(Write(title), run_time=0.9)
        self.play(FadeIn(subtitle, shift=UP * 0.1), run_time=0.5)
        return heading

    def show_stage_rail(self) -> tuple[VGroup, list[VGroup]]:
        nodes: list[VGroup] = []
        for name in STAGES:
            dot = RoundedRectangle(
                corner_radius=0.18,
                width=0.36,
                height=0.36,
                fill_color=MUTED,
                fill_opacity=1.0,
                stroke_color=BORDER,
                stroke_width=2.0,
            )
            nodes.append(VGroup(dot, label(name, 16, FAINT).next_to(dot, DOWN, buff=0.14)))

        rail = VGroup(*nodes).arrange(RIGHT, buff=1.05).to_edge(UP, buff=1.85)
        connectors = VGroup(
            *[
                Line(
                    nodes[index][0].get_right(),
                    nodes[index + 1][0].get_left(),
                    stroke_color=BORDER,
                    stroke_width=2.5,
                )
                for index in range(len(nodes) - 1)
            ]
        )
        rail.add(connectors)
        self.play(Create(rail), run_time=1.0)
        return rail, nodes

    def light_stage(self, nodes: list[VGroup], index: int, color: str = PRIMARY) -> None:
        """Advance the rail so the viewer always knows which stage is running."""
        dot = nodes[index][0]
        self.play(
            dot.animate.set_fill(color, opacity=1.0).set_stroke(color, width=2.0),
            nodes[index][1].animate.set_color(FOREGROUND),
            run_time=0.35,
        )

    def show_request(self) -> VGroup:
        box = card(6.4, 0.95, fill="#FFFFFF")
        text = label('"Rotate refresh tokens and cover it with tests"', 21, FOREGROUND)
        request = VGroup(box, text)
        text.move_to(box.get_center())
        request.move_to([0, -0.35, 0])
        self.play(FadeIn(request, shift=UP * 0.2), run_time=0.6)
        return request

    def decompose(self, request: VGroup) -> list[VGroup]:
        """Plan: one request splits into independently reviewable units."""
        units: list[VGroup] = []
        for name, _model, _placement, color in WORK_UNITS:
            box = card(3.1, 1.55)
            title = label(name, 20, FOREGROUND, BOLD)
            accent = Line(
                box.get_corner(UP + LEFT) + RIGHT * 0.16,
                box.get_corner(UP + LEFT) + RIGHT * 0.62,
                stroke_color=color,
                stroke_width=5.0,
            ).shift(DOWN * 0.12)
            title.move_to(box.get_center() + UP * 0.45)
            units.append(VGroup(box, accent, title))

        row = VGroup(*units).arrange(RIGHT, buff=0.42).move_to([0, -0.9, 0])
        self.play(Transform(request, row.copy()), run_time=0.7)
        self.remove(request)
        self.play(FadeIn(row, shift=DOWN * 0.1), run_time=0.5)
        return units

    def route(self, units: list[VGroup], nodes: list[VGroup]) -> None:
        """Route: each unit earns a model, and the placement is explicit."""
        self.light_stage(nodes, 0)
        self.light_stage(nodes, 1)

        for unit, (_name, model, placement, color) in zip(units, WORK_UNITS):
            chip = mono(model, 15, color)
            where = label(placement, 14, FAINT)
            stack = VGroup(chip, where).arrange(DOWN, buff=0.1)
            stack.move_to(unit[0].get_center() + UP * 0.02)
            self.chips.add(stack)
        self.play(FadeIn(self.chips, shift=UP * 0.1), run_time=0.7)

        for unit, (_n, _m, _p, color) in zip(units, WORK_UNITS):
            unit[0].set_stroke(color, width=2.0)

    def verify(self, units: list[VGroup], nodes: list[VGroup]) -> None:
        """Execute and Validate: deterministic gates, not assurances."""
        self.light_stage(nodes, 2)
        self.light_stage(nodes, 3, SUCCESS)

        for unit in units:
            passed = label("gates 3/3 passed", 14, SUCCESS)
            passed.move_to(unit[0].get_center() + DOWN * 0.52)
            self.gates.add(passed)
        self.play(FadeIn(self.gates), run_time=0.5)
        self.play(
            *[unit[0].animate.set_stroke(SUCCESS, width=2.0) for unit in units],
            run_time=0.4,
        )

    def compress_to_receipt(self, units: list[VGroup], nodes: list[VGroup]) -> VGroup:
        """The compression step: many runs collapse into one evidence packet."""
        box = card(7.4, 2.2)
        heading = label("Route receipt", 20, FOREGROUND, BOLD)
        rows = VGroup(
            *[
                mono(line, 15, FAINT)
                for line in (
                    "controller   Codex  (never replaced)",
                    "workers      3 units - reported and verified",
                    "checks       9/9 gates passed",
                    "cost         $0.38   latency 11m 42s",
                )
            ]
        ).arrange(DOWN, buff=0.14, aligned_edge=LEFT)

        body = VGroup(heading, rows).arrange(DOWN, buff=0.22, aligned_edge=LEFT)
        body.move_to(box.get_center())
        receipt = VGroup(box, body).move_to([0, -1.0, 0])

        # The units and every annotation attached to them clear together, so
        # nothing shows through the receipt that replaces them.
        collapsing = VGroup(*units, self.chips, self.gates)
        self.play(FadeOut(collapsing, scale=0.9), run_time=0.5)
        self.play(FadeIn(receipt, shift=UP * 0.15), run_time=0.7)
        return receipt

    def approval_boundary(self, receipt: VGroup, nodes: list[VGroup]) -> None:
        """Approve stays human: the product never auto-approves its own work."""
        self.light_stage(nodes, 4, WARNING)

        pointer = Arrow(
            start=receipt.get_top() + UP * 0.85,
            end=receipt.get_top() + UP * 0.12,
            color=WARNING,
            stroke_width=4.0,
            buff=0.0,
        )
        prompt = label("A human approves. Docket never approves its own work.", 19, WARNING, BOLD)
        prompt.next_to(pointer, UP, buff=0.14)
        self.play(Create(pointer), Write(prompt), run_time=0.8)
        self.wait(1.2)
        self.play(FadeOut(VGroup(pointer, prompt)), run_time=0.4)
        self.light_stage(nodes, 5, SUCCESS)
        self.wait(0.6)
