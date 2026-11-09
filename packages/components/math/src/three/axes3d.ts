import {
    component2d,
    Flow,
    Geo,
    Graphics3D,
    Mat,
    Paint,
    provides,
    Shapes,
    Types,
    View3D,
    type Canvas3DProps,
    type Color,
    type NodeOf,
    type Scene3D,
    type Transform3D,
    type Values,
    type Vector3,
    type Vector3Input,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Alignment as _Alignment,
    type CornerRadiusResolved as _CornerRadiusResolved,
    type CornerStyleResolved as _CornerStyleResolved,
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type NormalizedColor as _NormalizedColor,
    type PostEffect3D as _PostEffect3D,
    type RectCornerRadius as _RectCornerRadius,
    type RectCornerStyle as _RectCornerStyle,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Shadows3D as _Shadows3D,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
    type ToneMapping3D as _ToneMapping3D,
    type Vector2 as _Vector2,
} from "@motionscript/sdk";
import type { Interval } from "../kit/coords";
import { AXIS_COLOR, lerpInterval, readInterval } from "../kit/furniture";
import { clamp } from "../kit/geometry";
import { formatTick, ticksFor } from "../kit/ticks";
import { drawLabel3D, type LabelStyle3D } from "./label3d";
import { GRAPH_3D, graphSpace, type Graph3D, type GraphSpace } from "./space";

export interface Axes3dProps extends Canvas3DProps {
    xRange?: Interval;
    yRange?: Interval;
    zRange?: Interval;
    xLength?: number;
    yLength?: number;
    zLength?: number;
    xStep?: number;
    yStep?: number;
    zStep?: number;
    color?: Color;
    thickness?: number;
    tips?: boolean;
    ticks?: boolean;
    tickSize?: number;
    grid?: boolean;
    gridLineColor?: Color;
    labels?: boolean;
    labelSize?: number;
    labelColor?: Color;
    fontFamily?: string;
    xLabel?: string;
    yLabel?: string;
    zLabel?: string;
}

/** How many pixels of a 2D axis one scene unit counts as, when an axis picks its own tick spacing. */
const UNIT_AS_PIXELS = 64;

type AxisName = "x" | "y" | "z";

/** The turn that lays a shape built along the scene's +y along each graph axis. */
const ALONG: Record<AxisName, Vector3Input> = { x: [90, 0, 0], y: [0, 0, -90], z: [0, 0, 0] };

/** The graph axis each axis's tick marks lie along. */
const TICK_ALONG: Record<AxisName, AxisName> = { x: "y", y: "x", z: "y" };

function range(initial: Interval) {
    return Types.custom<Interval>(initial, { resolve: readInterval, lerp: lerpInterval });
}

/** The axes' own entries, beside a 3D canvas's. */
const own = {
    xRange: range([-3, 3]),
    yRange: range([-3, 3]),
    zRange: range([-2, 2]),
    /** How long each axis is drawn, in scene units. */
    xLength: Types.number(6, { min: 0.01, step: 0.1 }),
    yLength: Types.number(6, { min: 0.01, step: 0.1 }),
    zLength: Types.number(4, { min: 0.01, step: 0.1 }),
    /** The spacing of each axis's ticks; zero picks a tidy one for the axis's length. */
    xStep: Types.number(0, { min: 0 }),
    yStep: Types.number(0, { min: 0 }),
    zStep: Types.number(0, { min: 0 }),
    color: Types.color(AXIS_COLOR),
    /** The radius of an axis line, in scene units. */
    thickness: Types.number(0.02, { min: 0, step: 0.005 }),
    tips: Types.boolean(true, { animatable: false }),
    ticks: Types.boolean(true, { animatable: false }),
    tickSize: Types.number(0.16, { min: 0, step: 0.01 }),
    /** Lines across the plane the x and y axes lie in, at each of their ticks. */
    grid: Types.boolean(false, { animatable: false }),
    /** (`gridColor` is the viewport's own reference grid.) */
    gridLineColor: Types.color("#374151"),
    /** A number at each tick. */
    labels: Types.boolean(false, { animatable: false }),
    /** The height of a label's text, in scene units. */
    labelSize: Types.number(0.26, { min: 0.01, step: 0.01 }),
    labelColor: Types.color(AXIS_COLOR),
    fontFamily: Types.text("", { animatable: false }),
    /** A title at the positive end of each axis. */
    xLabel: Types.text("x", { animatable: false }),
    yLabel: Types.text("y", { animatable: false }),
    zLabel: Types.text("z", { animatable: false }),
};

type AxesValues = Values<typeof own>;

/**
 * A 3D graph: three axes through a box of graph coordinates, z up, seen through
 * a camera of its own, so it stands on a 2D stage as it is, the way `axes2d`
 * does. Its 3D children sit in its graph coordinates: a surface, a space curve,
 * a point, an arrow, or any 3D node. `orbitTo` swings the camera round it.
 */
export const Axes3d = component2d({
    key: "axes3d",
    state: { ...Paint.state, ...Flow.state, ...Shapes.corners, ...View3D.state, ...own },
    defaults: { width: "fill", height: "fill" },
    commands: {
        ...Paint.commands,
        ...View3D.commands,
        /** Animate the window of values the axes show; everything drawn in them follows. */
        rangeTo: { args: ["xRange", "yRange", "zRange"] },
    },
    allowedChildren: ["2d", "3d"],
    load: (loader, s) => {
        View3D.load(loader, furnish(s));
        if (s.fontFamily !== "") loader.font(s.fontFamily);
    },
    provide: (s) => [provides(GRAPH_3D, graphOfAxes(s))],
    space: (s) => axesSpace(s),
    measure: (measurer, s, children) => Flow.measure(measurer, s, children, Paint.inset(s)),
    layout: (box, s, children) => Flow.layout(box, s, children, Paint.inset(s)),
    render: (ctx, s) => View3D.draw(ctx, s, furnish(s)),
});

export type Axes3d = NodeOf<typeof Axes3d>;

/** The axes' own drawing, added to the scene: what `render` draws and `load` declares. */
function furnish(s: AxesValues): (scene: Scene3D) => void {
    return (scene) => scene.draw(furniture(s));
}

/** The last space worked out for each axes, kept while its ranges and lengths are unchanged. */
const spaces = new WeakMap<object, { readonly key: string; readonly space: GraphSpace }>();

/** The coordinates of a 3D graph: what its children's `x`, `y` and `z` are in. */
function axesSpace(s: AxesValues): GraphSpace {
    const { xRange, yRange, zRange, xLength, yLength, zLength } = s;
    const key = [xRange, yRange, zRange, xLength, yLength, zLength].join("|");
    let kept = spaces.get(s);
    if (kept?.key !== key) spaces.set(s, (kept = { key, space: graphSpace(xRange, yRange, zRange, { x: xLength, y: yLength, z: zLength }) }));
    return kept.space;
}

// One per axes, so the context its subtree holds is the same from frame to frame.
const graphs = new WeakMap<object, Graph3D>();

function graphOfAxes(s: AxesValues): Graph3D {
    let graph = graphs.get(s);
    if (!graph) graphs.set(s, (graph = { space: () => axesSpace(s) }));
    return graph;
}

/** The axes, their ticks, numbers and titles, and the grid, in the scene's units. */
function furniture(s: AxesValues): Graphics3D {
    const space = axesSpace(s);
    const g3 = new Graphics3D();
    const ranges: Record<AxisName, Interval> = { x: space.xRange, y: space.yRange, z: space.zRange };
    const lengths: Record<AxisName, number> = { x: s.xLength, y: s.yLength, z: s.zLength };
    const steps: Record<AxisName, number> = { x: s.xStep, y: s.yStep, z: s.zStep };
    const titles: Record<AxisName, string> = { x: s.xLabel, y: s.yLabel, z: s.zLabel };
    // Where each axis is crossed by the other two: their zero, or the nearest end of a range without one.
    const cross: Record<AxisName, number> = {
        x: clamp(0, ranges.x[0], ranges.x[1]),
        y: clamp(0, ranges.y[0], ranges.y[1]),
        z: clamp(0, ranges.z[0], ranges.z[1]),
    };
    const at = (axis: AxisName, value: number, shift: Partial<Record<AxisName, number>> = {}): Vector3 => {
        const point = { ...cross, [axis]: value };
        const local = space.toLocal(point.x, point.y, point.z);
        const moved = space.offset(0, 0, 0);
        for (const key of ["x", "y", "z"] as const) {
            const by = shift[key];
            if (by === undefined) continue;
            // A shift is in scene units, along the graph axis it names.
            if (key === "x") moved.z += by;
            else if (key === "y") moved.x += by;
            else moved.y += by;
        }
        return { x: local.x + moved.x, y: local.y + moved.y, z: local.z + moved.z };
    };

    const { thickness, tickSize } = s;
    const paint = Mat.basic({ color: s.color });
    const style: LabelStyle3D = { size: s.labelSize, color: s.labelColor, fontFamily: s.fontFamily };
    const tipLength = s.tips ? thickness * 9 : 0;
    const marks: Transform3D[] = [];
    const plane: Vector3[] = [];

    for (const axis of ["x", "y", "z"] as const) {
        const [min, max] = ranges[axis];
        const length = lengths[axis];
        if (!(max > min) || !(length > 0)) continue;

        if (thickness > 0) {
            const from = at(axis, min);
            const to = at(axis, max);
            g3.mesh(Geo.cylinder({ radius: thickness, height: length, segments: [12, 1] }), paint, {
                position: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 },
                rotation: ALONG[axis],
            });
            if (s.tips) {
                g3.mesh(Geo.cone({ radius: thickness * 3.2, height: tipLength, segments: [16, 1] }), paint, {
                    position: at(axis, max, { [axis]: tipLength / 2 }),
                    rotation: ALONG[axis],
                });
            }
        }

        const ticks = ticksFor(ranges[axis], steps[axis], length * UNIT_AS_PIXELS);
        const side = TICK_ALONG[axis];
        for (const value of ticks.values) {
            // The crossing is marked by the other axes, and the far end by the tip.
            if (Math.abs(value - cross[axis]) < 1e-9 || (s.tips && Math.abs(value - max) < 1e-9)) continue;
            if (s.ticks && tickSize > 0) marks.push({ position: at(axis, value), rotation: ALONG[side] });
            if (s.labels) {
                drawLabel3D(g3, formatTick(value, ticks.step), at(axis, value, { [side]: -(tickSize / 2 + style.size * 0.8) }), style);
            }
        }
        drawLabel3D(g3, titles[axis], at(axis, max, { [axis]: tipLength + style.size * 0.9 }), style);

        if (s.grid && axis !== "z") {
            const other = axis === "x" ? "y" : "x";
            for (const value of ticks.values) {
                const a = { x: 0, y: 0, z: cross.z, [axis]: value, [other]: ranges[other][0] };
                const b = { ...a, [other]: ranges[other][1] };
                plane.push(space.toLocal(a.x, a.y, a.z), space.toLocal(b.x, b.y, b.z));
            }
        }
    }

    if (marks.length > 0) {
        g3.instances(Geo.cylinder({ radius: Math.max(thickness * 0.7, 0.008), height: tickSize, segments: [8, 1] }), paint, marks);
    }
    if (plane.length > 0) g3.line({ points: plane, segments: true, stroke: { fill: s.gridLineColor } });
    return g3;
}
