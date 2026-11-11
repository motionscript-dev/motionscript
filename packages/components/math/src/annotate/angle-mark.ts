import {
    component2d,
    Graphics2D,
    Types,
    type NodeOf,
    type Color as _Color,

    type NormalizedColor,
    type PathCommand,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { listed, omit, PAINT, PAINT_COMMANDS, painted } from "../kit/component";
import { outlineBounds, OWN_FRAME } from "../kit/follow";
import { drawLabels, loadFormulas } from "../kit/furniture";
import { radians } from "../kit/geometry";
import { strokeShape } from "../kit/mark";

/** Degrees of arc per drawn segment. */
const ARC_STEP = 4;
/** How close to a right angle `auto` draws the square. */
const RIGHT_SLOP = 0.5;

const point = (radius: number, degrees: number) => {
    const turn = radians(degrees);
    return { x: radius * Math.cos(turn), y: radius * Math.sin(turn) };
};

const state = {
    // It is only an outline.
    ...omit(PAINT, "fill"),
    fromAngle: Types.number(0, { unit: "°" }),
    toAngle: Types.number(60, { unit: "°" }),
    radius: Types.number(48, { min: 0, unit: "px" }),
    /** `auto` draws the square where the angle is a right one. */
    corner: listed(["auto", "arc", "square"], "auto", { animatable: false }),
    /** Text, a formula between dollar signs, or `°` for the angle's own size. */
    label: Types.text("", { animatable: false }),
    labelSize: Types.number(24, { min: 1, unit: "px" }),
    labelColor: Types.color("#e5e7eb"),
    fontFamily: Types.text("", { animatable: false }),
    /** The angle marked, in degrees: positive counter-clockwise. A formula reads it back as `[key.value]`. */
    value: Types.number(0, { private: true }),
};

interface AngleValues {
    readonly fromAngle: number;
    readonly toAngle: number;
    readonly radius: number;
    readonly corner: "arc" | "square" | "auto";
}

/**
 * The mark of an angle at the node's own position: an arc from one direction
 * to another, or the small square of a right angle, with an optional label.
 * Directions are degrees counter-clockwise from the right, so binding one to a
 * variable opens and closes the angle. A label of `°` shows the angle's size.
 */
export const AngleMark = component2d({
    key: "angleMark",
    state,
    defaults: { stroke: { weight: 3, fill: "#e5e7eb", align: "center", cap: "round", join: "round" }, width: "hug", height: "hug", value: (s) => angleOf(s) },
    load: (loader, s) => {
        if (s.label !== "" && s.fontFamily !== "") loader.font(s.fontFamily);
        loadFormulas(loader, [s.label]);
    },
    commands: {
        ...omit(PAINT_COMMANDS, "fillTo"),
        /** Grow or shrink the mark. */
        radiusTo: { args: ["radius"] },
    },
    measure: () => ({ width: 0, height: 0 }),
    bounds: (_size, s) => outlineBounds(outline(s)),
    render: (ctx, s) => {
        const data = outline(s);
        const shape = data.length > 0 ? () => new Graphics2D().path({ data, centerBounds: OWN_FRAME, start: s.start, end: s.end }) : null;
        painted(
            ctx,
            () => {
                if (shape) ctx.draw(shape().shadow(s.shadow).fill([]));
                if (s.label === "" || s.radius <= 0) return;
                const text = s.label === "°" ? `${Math.round(Math.abs(s.value) * 10) / 10}°` : s.label;
                const at = point(s.radius + s.labelSize * 0.9, (s.fromAngle + s.toAngle) / 2);
                const style = { fontSize: s.labelSize, fontFamily: s.fontFamily, color: s.labelColor as NormalizedColor };
                ctx.draw(drawLabels([{ text, at, align: "center" }], style));
            },
            () => {
                if (shape) strokeShape(ctx, shape, s);
            },
        );
    },
});

export type AngleMark = NodeOf<typeof AngleMark>;

/** The angle a mark marks, in degrees: positive counter-clockwise. */
export function angleOf(s: Pick<AngleValues, "fromAngle" | "toAngle">): number {
    return s.toAngle - s.fromAngle;
}

function outline({ fromAngle, toAngle, radius, corner }: AngleValues): PathCommand[] {
    const sweep = toAngle - fromAngle;
    if (radius <= 0 || sweep === 0) return [];
    const square = corner === "square" || (corner === "auto" && Math.abs(Math.abs(sweep) - 90) < RIGHT_SLOP);
    if (square) {
        const side = radius * 0.6;
        const a = point(side, fromAngle);
        const b = point(side, toAngle);
        return [
            { type: "M", x: a.x, y: a.y },
            { type: "L", x: a.x + b.x, y: a.y + b.y },
            { type: "L", x: b.x, y: b.y },
        ];
    }
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
    const out: PathCommand[] = [];
    for (let i = 0; i <= steps; i++) {
        const p = point(radius, fromAngle + (sweep * i) / steps);
        out.push({ type: i === 0 ? "M" : "L", x: p.x, y: p.y });
    }
    return out;
}
