import {
    Camera,
    Flow,
    Graphics2D,
    Paint,
    type BoxBounds,
    type ChildView,
    type Measurer,
    type Placement2D,
    type RenderContext,
    type Size2D,
    type Values,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Alignment as _Alignment,
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
    type Vector2 as _Vector2,
} from "@motionscript/sdk";

/**
 * What a background that fills whatever region is currently visible shares,
 * rather than a fixed rect: `GridPattern` is built from it, and so is a pattern
 * of your own. Spread `state` and `commands` in, pass `measure` and `layout`, and
 * draw with {@link draw}.
 *
 * Placed inside a `Camera`, the pattern is handed the world region the camera
 * can currently see (from its `zoom`/`lookAt`/`heading`), so it only ever
 * generates geometry for what's on screen, with no oversized node sized for the
 * worst-case pan and zoom. With no `Camera` above it, it fills its own box, so the
 * same pattern doubles as an ordinary full-bleed background.
 *
 * The pattern is itself a camera child, laid out at the camera's centre, so its
 * local draw space shares the world origin its siblings use. The visible region
 * is therefore expressed directly in that space: centred on the camera's
 * `lookAt`, sized to the inverse of the camera transform.
 */

/** A pattern is a shape: paints, and children laid out like a rect's. */
export const state = { ...Paint.state, ...Flow.state };

export const commands = { ...Paint.commands };

type ShapeState = Flow.FlowState & Values<typeof Paint.state>;

export function measure(measurer: Measurer, s: ShapeState, children: readonly ChildView[]): Size2D {
    return Flow.measure(measurer, s, children, Paint.inset(s));
}

export function layout(box: BoxBounds, s: ShapeState, children: readonly ChildView[]): readonly Placement2D[] {
    return Flow.layout(box, s, children, Paint.inset(s));
}

/**
 * The region the pattern covers, in its own draw space: the world rect the
 * nearest `Camera` above it sees, or its own box when there is none.
 */
export function visibleBounds(ctx: RenderContext): BoxBounds {
    const camera = ctx.ancestor(Camera);
    if (!camera) return { x: 0, y: 0, width: ctx.size.width, height: ctx.size.height };

    const { width: vw, height: vh } = camera.size;
    const zoom = camera.state.zoom || 1;
    const heading = camera.state.heading;

    // Inverse of the camera scale: a viewport `vw×vh` shows `vw/zoom × vh/zoom` of the world.
    const hw = vw / 2 / zoom;
    const hh = vh / 2 / zoom;

    // With a heading the visible world rect is rotated; take its axis-aligned
    // bounding box so the pattern covers the rotated viewport's full extent.
    let bw = hw;
    let bh = hh;
    if (heading !== 0) {
        const rad = (heading * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        bw = hw * cos + hh * sin;
        bh = hw * sin + hh * cos;
    }

    // Centred on the camera's `lookAt`, in y-up world space (the descriptor
    // convention; the renderer applies the single y-up→canvas flip when the
    // pattern's shapes are drawn).
    const lookAt = camera.state.lookAt;
    return { x: lookAt.x, y: lookAt.y, width: bw * 2, height: bh * 2 };
}

/**
 * Paint `pattern` over the visible region, once per render, then the children.
 *
 * The pattern is clipped to the region, so geometry overscanned past the edge
 * (so thick lines slide out instead of popping) trims cleanly. Inside a camera
 * the viewport already clips, but this keeps edge strokes clean and bounds the
 * work with no camera too. A `centerBounds` for a path drawn here is
 * `[bounds.x - w/2, bounds.y - h/2, bounds.x + w/2, bounds.y + h/2]`.
 */
export function draw(ctx: RenderContext, pattern: (bounds: BoxBounds) => void): void {
    const bounds = visibleBounds(ctx);
    const region = new Graphics2D().rect({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    ctx.inFront(() => ctx.clip(region, () => pattern(bounds)));
    ctx.children();
}
