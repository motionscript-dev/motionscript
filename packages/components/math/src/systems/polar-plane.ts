import {
    component2d,
    Graphics2D,
    Types,
    type Extents,
    type NodeOf,
    type Color as _Color,

    type NormalizedColor,
    type Stroke as _Stroke,

    type StrokeResolved,
    type Values,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
} from "@motionscript/sdk";
import { listed, PAINT, PAINT_COMMANDS } from "../kit/component";
import { cartesianMap, type CoordinateMap } from "../kit/coords";
import { AXIS_COLOR, drawLabels, type Label } from "../kit/furniture";
import { radians } from "../kit/geometry";
import { drawSystem, systemLayout, systemMap, systemOpenPlane, systemProvides, systemSize } from "../kit/system";
import { formatTick, ticksFor } from "../kit/ticks";

/** How much room, in label sizes, the angles written round the outer ring take from the plane. */
const LABEL_ROOM = 2.2;

const state = {
    ...PAINT,
    /** The radius of the outermost ring, in graph units. */
    radius: Types.number(4, { min: 0.0001, step: 0.5 }),
    /** The spacing of the rings; zero picks a tidy one for the plane's size. */
    ringStep: Types.number(0, { min: 0 }),
    /** How many spokes divide the turn; zero draws none. */
    spokes: Types.number(12, { min: 0, max: 72, step: 1, animatable: false }),
    angleUnit: listed(["degrees", "radians"], "degrees", { animatable: false }),
    /** The inner rings and the spokes. */
    gridStroke: Types.stroke({ weight: 1.25, fill: "#3b4658", align: "center" }),
    /** A number at each ring, and an angle at each spoke. */
    labels: Types.boolean(true, { animatable: false }),
    labelSize: Types.number(16, { min: 1, unit: "px" }),
    labelColor: Types.color(AXIS_COLOR),
    fontFamily: Types.text("", { animatable: false }),
};

type PolarValues = Values<typeof state>;

/** Rings and spokes about an origin: the plane a polar curve is read on. Children sit in its graph coordinates, as on axes. */
export const PolarPlane = component2d({
    key: "polarPlane",
    state,
    /** The outer ring and the two lines through the origin. */
    defaults: { stroke: { weight: 2, fill: AXIS_COLOR, align: "center" } },
    load: (loader, s) => {
        if (s.fontFamily !== "") loader.font(s.fontFamily);
    },
    commands: {
        ...PAINT_COMMANDS,
        /** Animate how far out the plane reaches: a zoom about its origin. */
        rangeTo: { args: ["radius"] },
    },
    provide: (s) => systemProvides(s),
    measure: (_measurer, s) => systemSize(s),
    layout: (box, s, children) => systemLayout(box, s, children, polarMap),
    plane: (box, s) => systemOpenPlane(box, s, polarMap),
    render: (ctx, s) => drawSystem(ctx, s, systemMap(ctx.size, s, polarMap), (map) => polarFurniture(map, s)),
});

export type PolarPlane = NodeOf<typeof PolarPlane>;

function polarMap(area: Extents, s: PolarValues): CoordinateMap {
    const width = area.maxX - area.minX;
    const height = area.maxY - area.minY;
    // The outer ring fits the shorter side, less the room its angles are written in; units are square.
    const reach = Math.max(1, Math.min(width, height) / 2 - (s.labels ? s.labelSize * LABEL_ROOM : 0));
    const unit = reach / Math.max(s.radius, 1e-9);
    return cartesianMap({
        xRange: [-width / 2 / unit, width / 2 / unit],
        yRange: [-height / 2 / unit, height / 2 / unit],
        area,
    });
}

function polarFurniture(map: CoordinateMap, s: PolarValues): Graphics2D[] {
    const stroke = s.stroke as StrokeResolved[];
    const grid = s.gridStroke as StrokeResolved[];
    const { start, end, radius } = s;
    const centre = map.toPoint(0, 0);
    const reach = map.toPoint(radius, 0).x - centre.x;
    if (!(reach > 0)) return [];
    const at = (r: number, degrees: number) => {
        const angle = radians(degrees);
        return map.toPoint(r * Math.cos(angle), r * Math.sin(angle));
    };
    const ring = (g: Graphics2D, r: number): Graphics2D => {
        const size = (map.toPoint(r, 0).x - centre.x) * 2;
        return g.ellipse({ x: centre.x, y: centre.y, width: size, height: size, start, end });
    };

    const parts: Graphics2D[] = [];
    const marks = ticksFor([0, radius], s.ringStep, reach);
    const rings = marks.values.filter((r) => r > 0 && r < radius * (1 - 1e-9));
    const count = Math.round(s.spokes);
    const turns = Array.from({ length: count }, (_, i) => (360 * i) / count);

    if (grid.length > 0) {
        const inner = new Graphics2D();
        for (const r of rings) ring(inner, r);
        // The four along the axes are drawn with them.
        for (const degrees of turns) {
            if (degrees % 90 !== 0) inner.line({ points: [centre, at(radius, degrees)], radius: 0, start, end });
        }
        if (rings.length > 0 || turns.some((degrees) => degrees % 90 !== 0)) parts.push(inner.stroke(grid));
    }
    if (stroke.length > 0) {
        parts.push(
            ring(new Graphics2D(), radius)
                .line({ points: [at(radius, 180), at(radius, 0)], radius: 0, start, end })
                .line({ points: [at(radius, 270), at(radius, 90)], radius: 0, start, end })
                .stroke(stroke),
        );
    }
    if (!s.labels) return parts;

    const size = s.labelSize;
    const labels: Label[] = [];
    for (const r of [...rings, radius]) {
        const p = map.toPoint(r, 0);
        labels.push({ text: formatTick(r, marks.step), at: { x: p.x - size * 0.2, y: p.y - size * 0.95 }, align: "right" });
    }
    for (const degrees of turns) {
        const p = at(radius, degrees);
        const cos = Math.cos(radians(degrees));
        const sin = Math.sin(radians(degrees));
        labels.push({
            text: s.angleUnit === "degrees" ? `${formatTick(degrees, 1)}°` : radiansLabel(degrees),
            at: { x: p.x + cos * size * 0.6, y: p.y + sin * size * 1.05 },
            align: cos > 0.3 ? "left" : cos < -0.3 ? "right" : "center",
        });
    }
    parts.push(...drawLabels(labels, { fontSize: size, fontFamily: s.fontFamily, color: s.labelColor as NormalizedColor }));
    return parts;
}

/** An angle in degrees as a fraction of π: 90 is `π/2`, 240 is `4π/3`. */
function radiansLabel(degrees: number): string {
    if (degrees === 0) return "0";
    let numerator = Math.round(degrees);
    let denominator = 180;
    for (let a = numerator, b = denominator; ; [a, b] = [b, a % b]) {
        if (b === 0) {
            numerator /= a;
            denominator /= a;
            break;
        }
    }
    const top = numerator === 1 ? "π" : `${numerator}π`;
    return denominator === 1 ? top : `${top}/${denominator}`;
}
