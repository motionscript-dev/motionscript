import type { FontStyle, TextStyle } from "@/attributes/text/types";
import type { TransformState } from "./descriptors/transform";
import type { MeasureContext2D } from "./measure-context";
import type { TextState } from "./descriptors/text";
import type { TextBlockLayout } from "./text-layout";
import type { Graphics2D } from "./graphics2d";
import type { Clip } from "./clip";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { MaskOptions } from "@/attributes/mask/mask";
import type { BooleanOperation } from "@/attributes/mask/boolean";
import type { NodeEffect } from "@/attributes/shape/effects/union";
import type { Size2D } from "@/attributes/layout/size";

/** Where an effect scope draws: `'foreground'` filters the node's own content, `'backdrop'` the canvas content already painted beneath it (clipped to its silhouette). See {@link RenderContext2D.beginEffects}. */
export type EffectTarget = "foreground" | "backdrop";

/** Pixels from {@link RenderContext2D.rasterize}: RGBA8888, unpremultiplied, top-down. `width`/`height` are device px (the pixel ratio actually used), not the logical size asked for. */
export interface RasterizedSurface {
    pixels: Uint8Array;
    width: number;
    height: number;
}

/** A box in the current node's local space (origin at the layout-cell centre); `left/top` are canvas y-down. */
export interface SpaceRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Reference rects a fill resolves against, supplied per node at `begin()`. `local` comes from the drawn shapes and `global` from the renderer's surface size, so only the parent frame is passed. */
export interface SpaceRects {
    /** The parent node's content rect, in this node's local space. */
    parent?: SpaceRect;
}

/** Per-node state for the duration of a node's draw scope: identity, gradient-space `rects` and per-frame motion, which motion-driven effects (motion blur) read instead of a fixed authored direction. Velocity fields are 0 when unknown: the first frame, or after a scrub/seek discontinuity. */
export interface NodeRenderState {
    id: string;
    rects: SpaceRects;
    elapsed: number;
    /** The frame delta, in seconds, used to derive displacement from velocity. */
    dt: number;
    /** Translational velocity in px/sec, world space (y-down). `{0,0}` when unknown. */
    velocity: Vector2;
    /** Heading of `velocity` in degrees (`atan2(vy, vx)`). `0` when unknown. */
    direction: number;
    /** Magnitude of `velocity` in px/sec. `0` when unknown. */
    speed: number;
    /** Rotational velocity in degrees/sec. `0` when unknown. Reserved for radial motion blur. */
    angularVelocity: number;
    /** Scale velocity in scale-units/sec. `0` when unknown. Reserved for zoom motion blur. */
    scaleVelocity: number;
}

/**
 * The drawing surface a `Node2D` paints into: the whole of what a node may ask of a renderer.
 *
 * Shapes are built with a {@link Graphics2D} command list and submitted via {@link draw}; shapes chained on one
 * `Graphics2D` before a paint call share a single surface. It extends {@link MeasureContext2D}, so a node
 * measures and draws through one object.
 *
 * An interface so node-facing and host-facing lists stay apart: `execute`, `screenshot`, `unmount` and `dispose`
 * drive a pass and mustn't be reachable from inside one. Every real backend still extends `CanvasRenderContext2D`,
 * keeping the `draw` to `drawGraphics` invariant that gives them one text-default resolution.
 * `RenderContext3D` is a sibling, not a subclass: they share no members.
 */
export interface RenderContext2D extends MeasureContext2D {
    measureText(
        text: string,
        fontSize: number,
        fontFamily: string,
        fontWeight?: number,
        letterSpacing?: number,
        fontStyle?: FontStyle,
    ): Size2D;

    // Inherited text-style defaults: `<DefaultTextStyle>` reaches node text through the context map; a raw `Graphics2D`
    // has no node to bind, so it inherits the same defaults (same `TextStyle` vocabulary and precedence) pushed around
    // a subtree and folded into each text op by `draw()`.

    /**
     * Sets text-style defaults until the matching {@link popTextStyle} (the drawn-graphics half of `<DefaultTextStyle>`).
     * `style` is merged per key onto the defaults in effect, so nesting accumulates and the inner value wins; values
     * are resolved, not callbacks. `null` opens a scope inheriting nothing, not even `theme.typography.default`
     * (`Code` does this so a serif scene face doesn't reflow monospaced code). Pair with `popTextStyle()` in a
     * `finally`: the stack is shared with every later sibling.
     */
    pushTextStyle(style: TextStyle | null): void;

    popTextStyle(): void;

    /** The defaults in effect: the innermost {@link pushTextStyle} scope, else the project's `theme.typography.default` (the same preset a `Text` node falls back to). */
    readonly defaultTextStyle: TextStyle;

    /** Replays a built `Graphics2D`. Resolves ambient text defaults onto the op list first, so the real renderer and the precomp asset walk agree on which font an under-specified `text` op uses (a family only one resolves is a font that never loads). */
    draw(graphics: Graphics2D): void;

    /**
     * Lays `state` out as it would be drawn and reports where every character landed (see {@link TextBlockLayout}
     * for the space and caret model). Glyph positions live in the backend's shaper, so a host's own caret and
     * selection can't compute them; DOM approximations drift once font, line height or wrapping change. Takes the
     * whole {@link TextState} because `'autofit'`, `wrap` and `textAlign` resolve in the backend and must match what is drawn.
     *
     * `null` when the backend can't measure (the default) or no caret model fits: text-on-path and styled-segment blocks.
     */
    layoutTextBlock(state: Partial<TextState>): TextBlockLayout | null;

    /** Pushes a transform and returns the context for draws in the transformed space; popped by `end()` for the node that pushed it. */
    transform(state: Partial<TransformState>): RenderContext2D;

    /** Opens a boolean-path scope: shapes drawn until `endBoolean()` are gathered (fills/strokes suppressed) and combined with `op`; the merged path then stays the active surface, so a paint-only `Graphics2D` submitted via `draw()` styles it. */
    beginBoolean(op: BooleanOperation): void;
    endBoolean(): void;

    // Imperative mask scope for node-level callers: beginMask, render the mask child, applyMask, render the content
    // children, endMask. The chain form lives on `Graphics2D` (`.mask().applyMask().endMask()`). `vector` mode collects
    // the mask child's path as a clipPath (fills/strokes suppressed); `alpha` and `luminance` render it into an
    // offscreen layer combined via blend modes.
    beginMask(options?: MaskOptions): void;
    applyMask(): void;
    endMask(): void;

    /** Pushes a clip from a {@link Clip} command list: its shapes are unioned (minus `cut()`s) into one path and intersected with the active clip, so any silhouette confines children. Also confines backdrop effects to the node's exact shape. Paired with `endClip()`. */
    beginClip(clip: Clip): void;
    endClip(): void;

    /**
     * Opens an effect scope over the node, paired with {@link endEffects}. `'foreground'` filters the node's own
     * drawing (blur, bulge, foreground posterize); `'backdrop'` filters what is already painted beneath it, clipped
     * to the active silhouette clip so the node's edges stay sharp (backdrop filters, magnify, backdrop shader).
     * The renderer routes each effect to an `ImageFilter` or a snapshot/redraw shader; callers never do.
     * `width`/`height` are the node's logical size, for size-relative effects (pixelate) and shader lens boxes.
     */
    beginEffects(effects: NodeEffect[], target: EffectTarget, width: number, height: number): void;
    endEffects(): void;

    /**
     * Draws `draw` into an offscreen buffer and returns its pixels. The buffer is `width` x `height` **logical** px,
     * origin at the centre (the space a node draws in), so `draw` can be an ordinary `render()` of a node subtree.
     * Backs `Tex.surface`: it runs inside the consuming frame, so a scrubbed frame equals a played one.
     * `null` when the backend can't rasterize offscreen (the material then renders without that map).
     * `pixelRatio` is a ceiling on the device-pixel scale; the renderer may clamp it.
     */
    rasterize(
        width: number,
        height: number,
        draw: () => void,
        pixelRatio?: number,
    ): RasterizedSurface | null;

    /**
     * Pushes a camera viewport: clips to `viewport` and applies the inverse camera transform so children render as
     * seen through the lens. Paired with `endCamera()`.
     *
     * @param viewport Bounding rect of the camera node in canvas space (centred coords).
     * @param lookAt   World-space point the camera looks at.
     * @param zoom     Uniform scale applied around `lookAt`.
     * @param heading  Camera rotation in degrees; the world rotates counter to it.
     */
    beginCamera(viewport: { x: number; y: number; width: number; height: number }, lookAt: Vector2, zoom: number, heading: number): void;
    endCamera(): void;

    /** Whether this context reads `NodeRenderState.rects`: true for anything that paints (`space:'parent'` fills resolve against them). A context that only inspects skips them, saving an object allocation per node per frame; see `Node2D.renderState`. */
    readonly readsSpaceRects: boolean;

    /**
     * Whether this context only cares about visible output: true for anything that paints (a zero-opacity subtree
     * contributes no pixels). A context that inspects rather than paints sets it `false`: its walk discovers which
     * images, videos, fonts and effects a frame references, and an invisible node's font may fade in two frames
     * later, so skipping it there is a missing asset, not an optimisation. See `Node2D.render`.
     */
    readonly drawsVisibleOnly: boolean;

}

/**
 * A render pass: a {@link RenderContext2D} plus the per-node scope bracket the walk opens around each node.
 * `begin`/`end` belong to `Node2D.render` and push onto the stack that `space:'parent'` fills and motion-driven
 * effects read; a custom `renderSelf` calling one would open a scope nothing closes, so it is handed only a
 * {@link RenderContext2D}.
 *
 * @internal
 */
export interface RenderPass2D extends RenderContext2D {
    /** Opens a node draw scope pushing the node's id and {@link NodeRenderState}; pair with `end()`, also when the scope throws. */
    begin(state: NodeRenderState): void;

    end(): void;
}
