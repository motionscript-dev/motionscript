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
 * What a pattern filling the camera's visible region shares: spread `state` and
 * `commands` in, pass `measure` and `layout`, and draw with {@link draw}. Inside a
 * `Camera` the pattern is handed the world region it can see, so it only generates
 * geometry for what is on screen; with none it fills its own box. It is laid out at
 * the camera's centre, so its draw space shares the world origin its siblings use.
 * A pattern is a shape: paints, and children laid out like a rect's.
 */
export const state = { ...Paint.state, ...Flow.state };

export const commands = { ...Paint.commands };

type ShapeState = Flow.FlowState & Values<typeof Paint.state>;

export function measure(measurer: Measurer, s: ShapeState, children: readonly ChildView[]): Size2D {
    return Flow.measure(measurer, s, children, Paint.inset(s));
}

export function layout(box: BoxBounds, s: ShapeState, children: readonly ChildView[]): readonly Placement2D[] {
    return Flow.layout(box, s, children, Paint.inset(s));
}

/** The world rect the nearest `Camera` sees, in the pattern's draw space, else its own box. */
export function visibleBounds(ctx: RenderContext): BoxBounds {
    const camera = ctx.ancestor(Camera);
    if (!camera) return { x: 0, y: 0, width: ctx.size.width, height: ctx.size.height };

    const { width: vw, height: vh } = camera.size;
    const zoom = camera.state.zoom || 1;
    const heading = camera.state.heading;

    const hw = vw / 2 / zoom;
    const hh = vh / 2 / zoom;

    // With a heading the visible rect is rotated; its axis-aligned bounding box covers the full extent.
    let bw = hw;
    let bh = hh;
    if (heading !== 0) {
        const rad = (heading * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        bw = hw * cos + hh * sin;
        bh = hw * sin + hh * cos;
    }

    // Centred on the camera's `lookAt`, in y-up world space.
    const lookAt = camera.state.lookAt;
    return { x: lookAt.x, y: lookAt.y, width: bw * 2, height: bh * 2 };
}

/**
 * Paints `pattern` over the visible region, then the children. Clipped to the
 * region so overscanned geometry trims cleanly even with no camera. A path drawn
 * here takes `centerBounds` of `[bounds.x - w/2, bounds.y - h/2, bounds.x + w/2, bounds.y + h/2]`.
 */
export function draw(ctx: RenderContext, pattern: (bounds: BoxBounds) => void): void {
    const bounds = visibleBounds(ctx);
    const region = new Graphics2D().rect({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    ctx.inFront(() => ctx.clip(region, () => pattern(bounds)));
    ctx.children();
}
