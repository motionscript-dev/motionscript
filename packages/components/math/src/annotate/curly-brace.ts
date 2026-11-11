import {
    component2d,
    Graphics2D,
    Types,
    type NodeOf,
    type NodeView,
    type Color as _Color,
    type NormalizedColor,
    type PathCommand,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { braceOutline } from "../kit/brace";
import { listed, painted } from "../kit/component";
import {
    add, between, container, FOLLOW_COMMANDS, FOLLOW_STATE, followedQuad, heading, outlineBounds, OWN_FRAME, resting,
    type FollowValues, type Quad,
} from "../kit/follow";
import { drawLabels, loadFormulas } from "../kit/furniture";
import { strokeShape } from "../kit/mark";

export type BraceSide = "below" | "above" | "left" | "right";

/** The edge of a target a brace runs along, as two corner indexes of its quad, read with the brace's bulge to the left. */
const EDGE: Record<BraceSide, [number, number]> = {
    below: [2, 3],
    above: [0, 1],
    left: [3, 0],
    right: [1, 2],
};

const state = {
    ...FOLLOW_STATE,
    side: listed(["below", "above", "left", "right"], "below", { animatable: false }),
    /** The two ends of a brace that follows nothing, from the brace's own position. It bulges to the left of tail to head. */
    tail: Types.vector2({ x: -80, y: 0 }),
    head: Types.vector2({ x: 80, y: 0 }),
    /** The room between the target and the brace. (`gap` is a layout's.) */
    clearance: Types.number(8, { min: 0, unit: "px" }),
    /** How far the brace reaches from its ends to its tip. (`depth` is a node's place in 3D.) */
    reach: Types.number(18, { min: 2, unit: "px" }),
    label: Types.text("", { animatable: false }),
    labelSize: Types.number(28, { min: 1, unit: "px" }),
    labelColor: Types.color("#e5e7eb"),
    fontFamily: Types.text("", { animatable: false }),
};

interface BraceValues extends FollowValues {
    readonly side: BraceSide;
    readonly tail: Vector2;
    readonly head: Vector2;
    readonly clearance: number;
    readonly reach: number;
}

/** Whether the brace follows nothing, and so spans its own two points. */
function spans(s: BraceValues, parted: NodeView | null): boolean {
    return !s.retarget && resting(s, parted) === null;
}

/** No target: the span itself, as an edge with nothing above it. */
function quadOf(s: BraceValues, parted: NodeView | null): Quad | null {
    return spans(s, parted) ? [s.head, s.tail, s.tail, s.head] : followedQuad(s, parted);
}

/** The edge the brace runs along, pushed out by the gap, and the way it bulges. */
function edgeOf(s: BraceValues, parted: NodeView | null, quad: Quad): { from: Vector2; to: Vector2; out: Vector2 } {
    const [i, j] = spans(s, parted) ? [1, 0] : EDGE[s.side];
    const { unit } = heading(quad[i], quad[j]);
    // Left of the edge's own direction, in a y-up frame.
    const out = { x: -unit.y, y: unit.x };
    return { from: add(quad[i], out, s.clearance), to: add(quad[j], out, s.clearance), out };
}

function outline(s: BraceValues, parted: NodeView | null): PathCommand[] {
    const quad = quadOf(s, parted);
    if (!quad) return [];
    const { from, to, out } = edgeOf(s, parted, quad);
    return braceOutline(from, to, out, s.reach);
}

/** One of the two ends to drag, while the brace spans them. */
const end = (which: "tail" | "head") => ({
    at: (s: BraceValues) => (spans(s, container(null, s)) ? s[which] : null),
    value: (at: Vector2) => ({ x: at.x, y: at.y }),
});

/**
 * A curly brace along one side of a node or of a part of a formula, or between
 * two points when it names neither, with an optional label at its tip. A label
 * written between dollar signs is typeset.
 */
export const CurlyBrace = component2d({
    key: "curlyBrace",
    state,
    defaults: { stroke: { weight: 3, fill: "#e5e7eb", align: "center", cap: "round", join: "round" }, width: "hug", height: "hug" },
    load: (loader, s) => {
        if (s.label !== "" && s.fontFamily !== "") loader.font(s.fontFamily);
        loadFormulas(loader, [s.label]);
    },
    commands: FOLLOW_COMMANDS,
    handles: { tail: end("tail"), head: end("head") },
    measure: () => ({ width: 0, height: 0 }),
    bounds: (_size, s) => outlineBounds(outline(s, container(null, s))),
    render: (ctx, s) => {
        const parted = container(ctx, s);
        const data = outline(s, parted);
        const shape = data.length > 0 ? () => new Graphics2D().path({ data, centerBounds: OWN_FRAME, start: s.start, end: s.end }) : null;
        painted(
            ctx,
            () => {
                if (shape) ctx.draw(shape().shadow(s.shadow).fill([]));
                if (s.label === "") return;
                const quad = quadOf(s, parted);
                if (!quad) return;
                const { from, to, out } = edgeOf(s, parted, quad);
                const reach = Math.min(s.reach, heading(from, to).length / 2) + s.labelSize * 0.75;
                const at = add(between(from, to), out, reach);
                const align = out.x > 0.5 ? "left" : out.x < -0.5 ? "right" : "center";
                const style = { fontSize: s.labelSize, fontFamily: s.fontFamily, color: s.labelColor as NormalizedColor };
                ctx.draw(drawLabels([{ text: s.label, at, align }], style));
            },
            () => {
                if (shape) strokeShape(ctx, shape, s);
            },
        );
    },
});

export type CurlyBrace = NodeOf<typeof CurlyBrace>;
