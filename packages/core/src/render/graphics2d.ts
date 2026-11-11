import type { RectState } from "./descriptors/rect";
import type { EllipseState } from "./descriptors/ellipse";
import type { PathState } from "./descriptors/path";
import type { LineState } from "./descriptors/line";
import type { PolygonState } from "./descriptors/polygon";
import type { PolygramState } from "./descriptors/polygram";
import type { TextState } from "./descriptors/text";
import type { RichTextState } from "./descriptors/richtext";
import type { ShapeAlignmentInput } from "./descriptors/shape";
import { PathBuilder } from "./descriptors/path-builder";
import type { Fill } from "@/attributes/shape/fill/chain";
import type { Stroke } from "@/attributes/shape/stroke/stroke";
import type { Shadow } from "@/attributes/shape/shadow/shadow";
import type { NodeEffect } from "@/attributes/shape/effects/union";
// A direct leaf import, not the `@/attributes` barrel: this file sits in a cycle (fill's canvas3d implementation ->
// render3d -> Node2D -> RenderContext2D -> here) the barrel would close, leaving `effectsOps` undefined at module init.
import { type Effect, effectsOps } from "@/attributes/shape/effects/chain";
import type { Alignment } from "@/attributes/layout/alignment";
import type { MaskOptions } from "@/attributes/mask/mask";

/** A union-level rotate/scale on the whole drawn silhouette. `center` is the pivot: an explicit {@link Vector2} in the graphics' local space or a named alignment resolved against the union's bounding box (default: its centre). */
export interface GraphicsTransform {
    rotation: number;
    scale: number;
    center?: Alignment;
}

/** The shape ops a {@link Graphics2D} can record, each carrying that shape's partial descriptor state. */
export type GraphicsShapeOp =
    | { kind: "rect"; state: Partial<RectState> & ShapeAlignmentInput }
    | { kind: "ellipse"; state: Partial<EllipseState> & ShapeAlignmentInput }
    | { kind: "path"; state: Partial<PathState> }
    | { kind: "line"; state: Partial<LineState> }
    | { kind: "polygon"; state: Partial<PolygonState> & ShapeAlignmentInput }
    | { kind: "polygram"; state: Partial<PolygramState> & ShapeAlignmentInput }
    | { kind: "text"; state: Partial<TextState> & ShapeAlignmentInput }
    | { kind: "richText"; state: Partial<RichTextState> & ShapeAlignmentInput };

/** One recorded operation: shape ops declare geometry; paint ops (fill/stroke/shadow) apply to the accumulated shapes; cut/mask ops composite. Replayed in order via `RenderContext2D.draw()`. */
export type GraphicsOp =
    | GraphicsShapeOp
    | { kind: "fill"; fills: Fill }
    | { kind: "stroke"; strokes: Stroke }
    | { kind: "shadow"; shadows: Shadow }
    | { kind: "cut" }
    | { kind: "mask"; options?: MaskOptions }
    | { kind: "applyMask" }
    | { kind: "endMask" }
    | { kind: "effects"; effects: NodeEffect[] };

const SHAPE_KINDS = new Set<GraphicsOp["kind"]>([
    "rect", "ellipse", "path", "line", "polygon", "polygram", "text", "richText",
]);

/**
 * A renderer-agnostic, chainable shape/paint builder: records shape declarations and paint/compositing ops without
 * touching a renderer, then `ctx.draw(graphics)` replays them against the backend.
 *
 *   const g = new Graphics2D()
 *       .ellipse({ width: 100, height: 100 })
 *       .rect({ width: 40, height: 40, rotation: 30 }) // per-shape: tilts this rect only
 *       .fill(Fills.color("red"))
 *       .stroke({ weight: 2, fill: "black" })
 *       .rotation(15)          // graphics-level: turns the whole union
 *       .effects(Effects.blur(6));  // graphics-level: blurs the whole drawn union
 *   ctx.draw(g);
 *
 * Shapes chained before a paint call combine into a single surface painted together (one gradient maps across all).
 * `cut()` uses the latest shape as a cutter against those before it; `mask()/applyMask()/endMask()` scope an inline mask.
 *
 * Transforms come in two flavours: a per-shape `rotation`/`scale` inside a shape's params is baked into that shape's
 * geometry before it joins the union, while graphics-level `.rotation(value, center?)` / `.scale(value, center?)`
 * transform the whole union about a pivot (default: its bounding-box centre). `opacity()` is also graphics-level: it
 * composites the whole drawn result as one layer, so a trailing `.opacity(0.4)` dims the union.
 *
 * `effects()` scopes like `fill()`: it applies to the shapes and paints accumulated since the previous `effects()` call
 * (or the start), then closes that group, so later shapes start fresh and unaffected. `.ellipse().ellipse().fill().effects(blur)`
 * blurs those two ellipses as one union while a following `.rect().fill()` stays crisp.
 */
export class Graphics2D {
    private _ops: GraphicsOp[] = [];
    private _opacity: number = 1;
    private _rotation: number = 0;
    private _scale: number = 1;
    private _transformCenter?: Alignment;

    rect(state: Partial<RectState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "rect", state });
        return this;
    }

    ellipse(state: Partial<EllipseState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "ellipse", state });
        return this;
    }

    path(state: Partial<PathState> | PathBuilder): this {
        const resolved = state instanceof PathBuilder ? state.toPathState() : state;
        this._ops.push({ kind: "path", state: resolved });
        return this;
    }

    line(state: Partial<LineState>): this {
        this._ops.push({ kind: "line", state });
        return this;
    }

    polygon(state: Partial<PolygonState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "polygon", state });
        return this;
    }

    polygram(state: Partial<PolygramState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "polygram", state });
        return this;
    }

    text(state: Partial<TextState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "text", state });
        return this;
    }

    richText(state: Partial<RichTextState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "richText", state });
        return this;
    }

    fill(fills: Fill): this {
        this._ops.push({ kind: "fill", fills });
        return this;
    }

    stroke(strokes: Stroke): this {
        this._ops.push({ kind: "stroke", strokes });
        return this;
    }

    shadow(shadows: Shadow): this {
        this._ops.push({ kind: "shadow", shadows });
        return this;
    }

    /** Uses the last-declared shape as a cutter: unions the shapes before it, subtracts it, and leaves the result as the current surface for subsequent shapes and paint. */
    cut(): this {
        this._ops.push({ kind: "cut" });
        return this;
    }

    /** Opens an inline mask scope: shapes until `applyMask()` are the mask, shapes after it are the content; close with `endMask()`. */
    mask(options?: MaskOptions): this {
        this._ops.push({ kind: "mask", options });
        return this;
    }

    applyMask(): this {
        this._ops.push({ kind: "applyMask" });
        return this;
    }

    endMask(): this {
        this._ops.push({ kind: "endMask" });
        return this;
    }

    /** Opacity of the whole graphics group (0-1): the entire drawn result composites into one layer at this alpha, so overlapping shapes don't double up. */
    opacity(opacity: number): this {
        this._opacity = opacity;
        return this;
    }

    /** Image effects for the current shape group, scoped like {@link fill}: shapes and paints since the previous `effects()` call (or the start) composite through the filter as one layer, so the effect reads the group's union silhouette (a blur bleeds across the combined edges). Closes the group: later shapes start fresh and unfiltered. Accepts an {@link Effect}, normalised to a `NodeEffect[]`. */
    effects(effects: Effect): this {
        this._ops.push({ kind: "effects", effects: effectsOps.resolve(effects) });
        return this;
    }

    /** Rotates the whole union (degrees) about `center` (an explicit {@link Vector2} or a named alignment resolved against the union's bounding box; default its centre), unlike a per-shape `rotation` inside a shape's params. */
    rotation(rotation: number, center?: Alignment): this {
        this._rotation = rotation;
        if (center !== undefined) this._transformCenter = center;
        return this;
    }

    /** Scales the whole union about `center`, as {@link rotation}. */
    scale(scale: number, center?: Alignment): this {
        this._scale = scale;
        if (center !== undefined) this._transformCenter = center;
        return this;
    }

    /** The recorded ops, in order. Consumed by `RenderContext2D.draw()`. */
    ops(): readonly GraphicsOp[] {
        return this._ops;
    }

    /** Graphics2D-level opacity (0–1) for the whole group. Default 1. */
    groupOpacity(): number {
        return this._opacity;
    }

    /** True when the whole graphics needs a composited layer (opacity < 1); each `effects` op scopes its own layer during replay (see {@link effects}). */
    needsGroupLayer(): boolean {
        return this._opacity < 1;
    }

    /** The union-level rotate/scale from {@link rotation} / {@link scale}, or `null` when both are identity; the renderer applies it as a canvas transform about `center` wrapping the drawn union. */
    groupTransform(): GraphicsTransform | null {
        if (this._rotation === 0 && this._scale === 1) return null;
        return { rotation: this._rotation, scale: this._scale, center: this._transformCenter };
    }

    /** True when there are no shape ops (only paint/compositing), so renderers can paint an externally-prepared surface (e.g. a boolean result) without resetting their shape accumulator. */
    isPaintOnly(): boolean {
        return !this._ops.some((op) => SHAPE_KINDS.has(op.kind));
    }

    /** A structural copy with its op list replaced and every group-level modifier carried over. A copy because a node may submit one `Graphics2D` more than once (`Text` draws the same ops for fill, overlay and stroke), each under different ambient state; rewriting the shared instance would leak one scope's resolution into the next. The seam `applyGraphicsTextDefaults` (see `render/text-defaults.ts`) folds inherited text defaults through. */
    /** @internal */
    _withOps(ops: GraphicsOp[]): Graphics2D {
        const next = new Graphics2D();
        next._ops = ops;
        next._opacity = this._opacity;
        next._rotation = this._rotation;
        next._scale = this._scale;
        next._transformCenter = this._transformCenter;
        return next;
    }
}
