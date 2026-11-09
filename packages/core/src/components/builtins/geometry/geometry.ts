import { lerpCornerScalarStyle, type CornerStyle, type RectCornerStyle } from "@/attributes/shape/corners/corner-style";
import { pathOps } from "@/attributes/shape/path/ops";
import { STAR_DEFAULT_POINTS, STAR_DEFAULT_RATIO, type ShapeOutlineKind } from "@/components/builtins/geometry/shape-outline";
import type { NodeOf } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import * as Shapes from "@/components/modules/shapes";
import type { Node2DProps } from "@/components/trees/2d/node2d";
import type { Fill } from "@/attributes/shape/fill/chain";
import type { Stroke } from "@/attributes/shape/stroke/stroke";
import type { Shadow } from "@/attributes/shape/shadow/shadow";
import type { FlowProps } from "@/layout/types";
import type { RectCornerRadius } from "@/attributes/shape/corners/corner-radius";
import type { PathData } from "@/render/descriptors/path";

/**
 * The geometry built-ins: paint, the flow engine for children (clear of the
 * stroke), and each one's outline.
 */

const scalarCorners = {
    cornerRadius: Types.number(0),
    cornerStyle: Types.custom<CornerStyle>("rounded", { lerp: lerpCornerScalarStyle }),
};

export const Rect = component2d({
    key: "rect",
    state: { ...Paint.state, ...Flow.state, ...Corners.state },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Corners.rect(ctx.size, state)),
});

export const Ellipse = component2d({
    key: "ellipse",
    state: {
        ...Paint.state, ...Flow.state,
        startAngle: Types.number(0),
        sweep: Types.number(360),
        ratio: Types.number(0),
    },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.ellipse(ctx.size, state)),
});

export const Polygon = component2d({
    key: "polygon",
    state: { ...Paint.state, ...Flow.state, sides: Types.number(5), ...scalarCorners },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.polygon(ctx.size, state)),
});

export const Polygram = component2d({
    key: "polygram",
    state: { ...Paint.state, ...Flow.state, sides: Types.number(5), ratio: Types.number(0.5), ...scalarCorners },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.polygram(ctx.size, state)),
});

/** The document's `path`: `data` in the unit space of its own box, so a resize is a width/height write. */
export const PathShape = component2d({
    key: "path",
    state: { ...Paint.state, ...Flow.state, data: Types.path },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.unitPath(ctx.size, state.data), { clipShape: Shapes.box(ctx.size) }),
});

/** Path data drawn at face value, hugging it: geometry written in code. */
export const Path = component2d({
    key: "facePath",
    state: { ...Paint.state, ...Flow.state, data: Types.path },
    defaults: { width: "hug", height: "hug" },
    commands: { ...Paint.commands },
    measure: (_measurer, state) => {
        const intrinsic = pathOps.size(state.data);
        const pad = state.padding;
        return { width: intrinsic.width + pad.left + pad.right, height: intrinsic.height + pad.top + pad.bottom };
    },
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.facePath(state.data), { clipShape: null }),
});

function boundsShape<const K extends string>(key: K, kind: ShapeOutlineKind) {
    return component2d({
        key,
        state: { ...Paint.state, ...Flow.state, ...scalarCorners },
        commands: { ...Paint.commands },
        measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
        layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
        render: (ctx, state) => Paint.draw(ctx, state, Shapes.outline(kind, ctx.size, state), { clipShape: Shapes.box(ctx.size) }),
    });
}

export const Triangle = boundsShape("triangle", "triangle");
export const RightTriangle = boundsShape("rightTriangle", "rightTriangle");
export const Pentagon = boundsShape("pentagon", "pentagon");
export const Hexagon = boundsShape("hexagon", "hexagon");
export const Octagon = boundsShape("octagon", "octagon");

export const Star = component2d({
    key: "star",
    state: {
        ...Paint.state, ...Flow.state, ...scalarCorners,
        points: Types.number(STAR_DEFAULT_POINTS),
        ratio: Types.number(STAR_DEFAULT_RATIO),
    },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.outline("star", ctx.size, {
        cornerRadius: state.cornerRadius, cornerStyle: state.cornerStyle, sides: Math.max(3, Math.round(state.points)), ratio: state.ratio,
    }), { clipShape: Shapes.box(ctx.size) }),
});

export type Rect = NodeOf<typeof Rect>;
export type Ellipse = NodeOf<typeof Ellipse>;
export type Polygon = NodeOf<typeof Polygon>;
export type Polygram = NodeOf<typeof Polygram>;
export type PathShape = NodeOf<typeof PathShape>;
export type Path = NodeOf<typeof Path>;
export type Triangle = NodeOf<typeof Triangle>;
export type RightTriangle = NodeOf<typeof RightTriangle>;
export type Pentagon = NodeOf<typeof Pentagon>;
export type Hexagon = NodeOf<typeof Hexagon>;
export type Octagon = NodeOf<typeof Octagon>;
export type Star = NodeOf<typeof Star>;

// What code building a shape names its props as. A call's own type is `CallProps<typeof Rect>`.

export interface PaintProps extends Node2DProps {
    /**
     * Fill layer(s). Each item can be:
     * - A plain CSS color string → treated as a solid fill
     * - A fill prop object (SolidFillProp, LinearGradientFillProp, …)
     * - An already-resolved fill object
     * - A {@link FillChain} from the `Fills` builder (e.g. `Fills.color('red')`)
     */
    fill?: Fill;
    /**
     * Stroke layer(s): a single {@link StrokeProp}, an array of them, or an
     * already-resolved stroke. `fill` inside each stroke accepts the same loose
     * values as the top-level fill prop.
     */
    stroke?: Stroke;
    /**
     * Shadow layer(s): a single {@link ShadowProp}, an array of them, or an
     * already-resolved shadow. `fill` inside each shadow accepts the same loose
     * values as the top-level fill prop.
     */
    shadow?: Shadow;
    start?: number;
    end?: number;
}

export interface ShapeProps extends PaintProps, FlowProps {
    /**
     * Overlay layer(s) — the same loose values as {@link PaintProps.fill}, but
     * painted *over* this node's fill **and** its children (clipped to the node's
     * silhouette) while still sitting **under** the stroke. Use for textures
     * laid across the whole subtree, e.g. a VHS-grain image or video.
     */
    overlay?: Fill;
}

export type FlexSize = number | "fill" | "hug";

export interface RectProps extends ShapeProps {
    /** Corner radius in pixels — uniform, per-corner, or per-axis. */
    cornerRadius: RectCornerRadius;
    /** How each corner is shaped once it has a radius: `'rounded'` or `'angled'`. */
    cornerStyle: RectCornerStyle;
}

export interface EllipseProps extends ShapeProps {
    ratio: number;
    sweep: number;
    startAngle: number;
}

export interface PolygonProps extends ShapeProps {
    /** Number of sides. Must be ≥ 3. */
    sides: number;
    /** Vertex rounding radius in pixels. */
    cornerRadius: number;
    /** Vertex shape: `'rounded'` (circular arc) or `'angled'` (chamfer). */
    cornerStyle: CornerStyle;
}

export interface PolygramProps extends ShapeProps {
    /** Number of outer points. Must be ≥ 3. */
    sides: number;
    /**
     * Inner-to-outer radius ratio (0–1). Controls how deeply the star points are cut.
     * At 1 the shape degenerates into a regular polygon; lower values produce sharper points.
     */
    ratio: number;
    /** Vertex rounding radius in pixels applied to both inner and outer vertices. */
    cornerRadius: number;
    /** Vertex shape: `'rounded'` (circular arc) or `'angled'` (chamfer). */
    cornerStyle: CornerStyle;
}

export interface PathShapeProps extends ShapeProps {
  /**
   * The geometry, as an SVG `d` string in the node's **unit box** — see
   * {@link PathData}.
   */
  data: PathData
}

export interface PathProps extends ShapeProps {
    data: PathData;
}

/**
 * The named shapes — a triangle, a right triangle, a pentagon, a hexagon, an
 * octagon, a star — as engine nodes.
 *
 * ## Why they aren't just a Polygon with `sides` set
 *
 * A `Polygon` inscribes its n-gon in the node's box, so a three-sided one leaves
 * a visible gap under its base (see `./shape-outline` for the full reason,
 * which is a good one: it's what makes a `sides` tween smooth). These fill the
 * box instead. The two behaviours can't be one node with a switch, because
 * "which shape is this" is the sort of thing a scene's author picks once and a
 * reader of the layers panel needs to see at a glance — so each is a type of its
 * own, named for what it draws.
 *
 * ## Why they're paths rather than polygons
 *
 * The silhouette is handed to the renderer as a `path` op rather than a
 * `polygon` one, which is what lets corner rounding be *ours*: the engine's
 * polygon geometry rounds the inscribed figure, and rounding a stretched one is
 * a different arc at every vertex. Drawing the outline ourselves also means the
 * shape a user is looking at and the shape they get when they start editing its
 * points are built by the same function, so converting to a Path node changes
 * nothing on screen.
 *
 * The outline is rebuilt per draw rather than cached against the box. It is a
 * handful of trig per vertex on a shape with at most ten of them, and the
 * alternative — a cache keyed on width, height, radius, style and the two
 * parametric fields — costs more to keep honest than it saves.
 */
export interface BoundsShapeProps extends ShapeProps {
  /** Vertex rounding radius in pixels. */
  cornerRadius: number
  /** Vertex shape: `'rounded'` (circular arc) or `'angled'` (chamfer). */
  cornerStyle: CornerStyle
}

export interface StarProps extends BoundsShapeProps {
  /** How many points the star has. */
  points: number
  /** Inner radius as a fraction of the outer one — how deep the points cut. */
  ratio: number
}
