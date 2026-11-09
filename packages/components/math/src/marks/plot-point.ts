import {
    component2d,
    Graphics2D,
    Types,
    type Color,
    type NodeOf,
    type NormalizedColor,
    type PaintProps,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { listed, omit, PAINT, PAINT_COMMANDS, painted } from "../kit/component";
import { curveValue } from "../kit/curve";
import { drawLabels, loadFormulas, type Label } from "../kit/furniture";
import { curveFor, PLANE_ENTRY, PLOT_REF, type GraphPlane } from "../kit/graph";
import { strokeShape } from "../kit/mark";
import { anchored } from "../kit/place";

export interface PlotPointProps extends PaintProps {
    on?: string;
    radius?: number;
    label?: string;
    labelSide?: "above" | "below" | "left" | "right";
    labelSize?: number;
    labelColor?: Color;
    fontFamily?: string;
}

const state = {
    // A dot has no outline worth trimming.
    ...omit(PAINT, "start", "end"),
    /** The plot this point rides, by id; empty for a point that sits at its own `x`/`y`. */
    on: PLOT_REF,
    radius: Types.number(7, { min: 0, unit: "px" }),
    label: Types.text("", { animatable: false }),
    labelSide: listed(["above", "below", "left", "right"], "above", { animatable: false }),
    labelSize: Types.number(18, { min: 1, unit: "px" }),
    labelColor: Types.color("#e5e7eb"),
    fontFamily: Types.text("", { animatable: false }),
    graph: PLANE_ENTRY,
    /** The graph height the point is at: the curve's when it rides one. A formula reads it back as `[key.value]`. */
    value: Types.number(0, { private: true }),
};

/**
 * A dot at graph coordinates, with an optional label. Named a plot in `on`, it
 * rides that curve: its `x` is where along it, and its height is the curve's.
 */
export const PlotPoint = anchored(component2d({
    key: "plotPoint",
    state,
    defaults: { fill: "#e5e7eb", width: "hug", height: "hug", value: (s) => heightOf(s.graph, s.on, s.x, s.y) },
    load: (loader, s) => {
        if (s.label !== "" && s.fontFamily !== "") loader.font(s.fontFamily);
        loadFormulas(loader, [s.label]);
    },
    commands: omit(PAINT_COMMANDS, "progressTo", "flash"),
    measure: (_measurer, s) => ({ width: s.radius * 2, height: s.radius * 2 }),
    render: (ctx, s) => {
        const size = s.radius * 2;
        const shape = size > 0 ? () => new Graphics2D().ellipse({ x: 0, y: 0, width: size, height: size }) : null;
        painted(
            ctx,
            () => {
                if (shape) ctx.draw(shape().shadow(s.shadow).fill(s.fill));
                if (s.label === "") return;
                const gap = s.radius + s.labelSize * 0.45;
                const side = s.labelSide;
                const horizontal = side === "left" || side === "right";
                const label: Label = {
                    text: s.label,
                    align: side === "left" ? "right" : side === "right" ? "left" : "center",
                    at: {
                        x: horizontal ? (side === "left" ? -1 : 1) * gap : 0,
                        y: horizontal ? 0 : (side === "below" ? -1 : 1) * (gap + s.labelSize / 2),
                    },
                };
                ctx.draw(drawLabels([label], { fontSize: s.labelSize, fontFamily: s.fontFamily, color: s.labelColor as NormalizedColor }));
            },
            () => {
                if (shape) strokeShape(ctx, shape, s);
            },
        );
    },
}), (s: { readonly on: unknown }, plane) => (x, y) => ({ x, y: heightOf(plane, s.on, x, y) }));

export type PlotPoint = NodeOf<typeof PlotPoint>;

/** The height a point at `x`/`y` sits at: the curve's, when it rides one that has a value there. */
function heightOf(plane: GraphPlane | null, on: unknown, x: number, y: number): number {
    const curve = curveFor(plane, on);
    const height = curve ? curveValue(curve, x) : NaN;
    // Off the end of its curve a point stays where its own `y` puts it rather than vanishing.
    return Number.isFinite(height) ? height : y;
}
