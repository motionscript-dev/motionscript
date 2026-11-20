import { invert, multiply, translation, type Matrix2D } from "@/attributes/layout/matrix2d";
import { vector2Ops, type Vector2 } from "@/attributes/layout/vector2";
import type { NodeOf, RepeatCopy } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import type { Node2DProps } from "@/components/trees/2d/node2d";

const FRACTION = { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" } as const;

const vector = (initial: Vector2) => Types.custom<Vector2>(initial, { lerp: vector2Ops.lerp, kind: "vector2" });

const state = {
    copies: Types.number(3, { min: 0, step: 1 }),
    offset: Types.number(0, { step: 0.1 }),
    composite: Types.oneOf(["below", "above"]),
    stepAnchor: Types.point({ x: 0, y: 0 }),
    stepPosition: vector({ x: 100, y: 0 }),
    stepScale: vector({ x: 1, y: 1 }),
    stepRotation: Types.number(0, { step: 1, unit: "°" }),
    startOpacity: Types.number(1, FRACTION),
    endOpacity: Types.number(1, FRACTION),
};

/** What a repeater's copies are made from. */
export interface RepeaterStep {
    copies: number;
    offset: number;
    composite: "below" | "above";
    stepAnchor: Vector2;
    stepPosition: Vector2;
    stepScale: Vector2;
    stepRotation: number;
    startOpacity: number;
    endOpacity: number;
}

/**
 * One step's transform scaled by `f` (1 is a whole step): moved by the position, turned and scaled about the anchor.
 * Built y down from the node's centre, as children are drawn; positions are y up, hence the flips.
 */
function stepMatrix(s: RepeaterStep, f: number): Matrix2D {
    const rad = (s.stepRotation * f * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const sx = Math.sign(s.stepScale.x) * Math.abs(s.stepScale.x) ** f;
    const sy = Math.sign(s.stepScale.y) * Math.abs(s.stepScale.y) ** f;
    const ax = s.stepAnchor.x, ay = -s.stepAnchor.y;
    const turn: Matrix2D = { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: 0, f: 0 };
    const about = multiply(translation(ax, ay), multiply(turn, translation(-ax, -ay)));
    return multiply(translation(s.stepPosition.x * f, -s.stepPosition.y * f), about);
}

/** The step applied `k` times; a fractional `k` ends on a part step, and a negative one steps backwards. */
function stepPower(s: RepeaterStep, k: number): Matrix2D {
    const whole = Math.trunc(k), part = k - whole;
    const unit = whole >= 0 ? stepMatrix(s, 1) : invert(stepMatrix(s, 1));
    let m: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (!unit) return m;
    for (let n = 0; n < Math.abs(whole); n++) m = multiply(m, unit);
    return part === 0 ? m : multiply(m, stepMatrix(s, part));
}

/**
 * Every copy in draw order. Copy `i` is the step applied `i + offset` times; opacity runs from
 * `startOpacity` on the first to `endOpacity` on the last, and a fractional count fades the last copy in.
 * `below` stacks each copy under the one before, so the first ends on top.
 */
export function repeaterCopies(s: RepeaterStep): RepeatCopy[] {
    const count = Math.max(0, s.copies);
    const whole = Math.ceil(count);
    const copies: RepeatCopy[] = [];
    for (let i = 0; i < whole; i++) {
        const t = whole > 1 ? i / (whole - 1) : 0;
        const ramp = s.startOpacity + (s.endOpacity - s.startOpacity) * t;
        const partial = i === whole - 1 && count < whole ? count - (whole - 1) : 1;
        copies.push({ matrix: stepPower(s, i + s.offset), opacity: Math.max(0, Math.min(1, ramp)) * partial });
    }
    return s.composite === "below" ? copies.reverse() : copies;
}

/** Its children, drawn again and again, each copy one step further: After Effects' Repeater. */
export const Repeater = component2d({
    key: "repeater",
    state,
    render: (ctx, s) => ctx.repeat(repeaterCopies(s)),
});

export type Repeater = NodeOf<typeof Repeater>;

export interface RepeaterProps extends Node2DProps, RepeaterStep {}
