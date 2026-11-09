import {
    component2d,
    Graphics2D,
    Types,
    type NodeOf,
    type NodeView,
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
import { listed, painted } from "../kit/component";
import {
    add, between, container, FOLLOW_COMMANDS, FOLLOW_STATE, followedQuad, grown, heading, outlineBounds, OWN_FRAME, type FollowProps, type FollowValues, type Quad,
} from "../kit/follow";
import { strokeShape } from "../kit/mark";

export type EmphasisShape = "box" | "circle" | "underline" | "cross";

export interface EmphasisMarkProps extends FollowProps {
    shape?: EmphasisShape;
    clearance?: number;
}

/** How far a cubic's handle reaches to draw a quarter of an ellipse. */
const QUARTER = 0.5523;

const line = (a: Vector2, b: Vector2): PathCommand[] => [
    { type: "M", x: a.x, y: a.y },
    { type: "L", x: b.x, y: b.y },
];

const SHAPES: Record<EmphasisShape, (quad: Quad, gap: number) => PathCommand[]> = {
    box: (quad, gap) => {
        const [tl, tr, br, bl] = grown(quad, gap);
        return [{ type: "M", x: tl.x, y: tl.y }, ...[tr, br, bl].map((p): PathCommand => ({ type: "L", x: p.x, y: p.y })), { type: "Z" }];
    },
    // The ellipse through the grown box's corners.
    circle: (quad, gap) => {
        const [tl, tr, br, bl] = grown(quad, gap);
        const centre = between(tl, br);
        const across = { x: ((tr.x - tl.x) / 2) * Math.SQRT2, y: ((tr.y - tl.y) / 2) * Math.SQRT2 };
        const up = { x: ((tl.x - bl.x) / 2) * Math.SQRT2, y: ((tl.y - bl.y) / 2) * Math.SQRT2 };
        const at = (a: number, u: number) => add(add(centre, across, a), up, u);
        const arc = (c1: Vector2, c2: Vector2, end: Vector2): PathCommand => ({
            type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y,
        });
        const k = QUARTER;
        const start = at(0, 1);
        return [
            { type: "M", x: start.x, y: start.y },
            arc(at(k, 1), at(1, k), at(1, 0)),
            arc(at(1, -k), at(k, -1), at(0, -1)),
            arc(at(-k, -1), at(-1, -k), at(-1, 0)),
            arc(at(-1, k), at(-k, 1), start),
            { type: "Z" },
        ];
    },
    underline: (quad, gap) => {
        const [, , br, bl] = quad;
        const down = heading(quad[0], bl).unit;
        return line(add(bl, down, gap), add(br, down, gap));
    },
    cross: (quad, gap) => {
        const [tl, tr, br, bl] = grown(quad, gap);
        return [...line(tl, br), ...line(bl, tr)];
    },
};

const state = {
    ...FOLLOW_STATE,
    shape: listed(["box", "circle", "underline", "cross"], "box", { animatable: false }),
    /** The room between the target and the mark. (`gap` is a layout's.) */
    clearance: Types.number(10, { unit: "px" }),
};

interface EmphasisValues extends FollowValues {
    readonly shape: EmphasisShape;
    readonly clearance: number;
}

function outline(s: EmphasisValues, parted: NodeView | null): PathCommand[] {
    const quad = followedQuad(s, parted);
    return quad ? SHAPES[s.shape](quad, s.clearance) : [];
}

/**
 * A box, a circle, an underline or a cross drawn on a node, or on one part of
 * a formula. `progressTo` draws it on, and `retargetTo` slides it to another.
 */
export const EmphasisMark = component2d({
    key: "emphasisMark",
    state,
    defaults: { stroke: { weight: 3, fill: "#facc15", align: "center", cap: "round", join: "round" }, width: "hug", height: "hug" },
    commands: FOLLOW_COMMANDS,
    measure: () => ({ width: 0, height: 0 }),
    bounds: (_size, s) => outlineBounds(outline(s, container(null, s))),
    render: (ctx, s) => {
        const data = outline(s, container(ctx, s));
        const shape = data.length > 0 ? () => new Graphics2D().path({ data, centerBounds: OWN_FRAME, start: s.start, end: s.end }) : null;
        painted(
            ctx,
            () => {
                if (shape) ctx.draw(shape().shadow(s.shadow).fill([]));
            },
            () => {
                if (shape) strokeShape(ctx, shape, s);
            },
        );
    },
});

export type EmphasisMark = NodeOf<typeof EmphasisMark>;
