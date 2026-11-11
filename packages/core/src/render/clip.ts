import type { RectState } from "./descriptors/rect";
import type { EllipseState } from "./descriptors/ellipse";
import type { PathState } from "./descriptors/path";
import type { LineState } from "./descriptors/line";
import type { PolygonState } from "./descriptors/polygon";
import type { PolygramState } from "./descriptors/polygram";
import type { ShapeAlignmentInput } from "./descriptors/shape";
import { PathBuilder } from "./descriptors/path-builder";

/** The shape ops a {@link Clip} can record: the {@link Graphics2D} geometry primitives minus text/image (no clippable outline). */
export type ClipShapeOp =
    | { kind: "rect"; state: Partial<RectState> & ShapeAlignmentInput }
    | { kind: "ellipse"; state: Partial<EllipseState> & ShapeAlignmentInput }
    | { kind: "path"; state: Partial<PathState> }
    | { kind: "line"; state: Partial<LineState> }
    | { kind: "polygon"; state: Partial<PolygonState> & ShapeAlignmentInput }
    | { kind: "polygram"; state: Partial<PolygramState> & ShapeAlignmentInput };

/** One recorded op in a {@link Clip}: shape ops add geometry to the region; `cut` subtracts the last-declared shape from those before it. Replayed into a single clip path via `RenderContext2D.beginClip()`. */
export type ClipOp = ClipShapeOp | { kind: "cut" };

/**
 * A renderer-agnostic, chainable clip-region builder: `Graphics2D` for clipping. Shapes combine (a union, with
 * `cut()`s subtracted), so a clip can be any compound silhouette, not just one rect or ellipse:
 *
 *   const c = new Clip()
 *       .rect({ width: 200, height: 120, cornerRadius: 16 })
 *       .ellipse({ x: 80, width: 60, height: 60 })   // unions with the rect
 *       .ellipse({ x: -80, width: 40, height: 40 })
 *       .cut();                                        // punches the last hole
 *   ctx.beginClip(c);
 *   ...draw clipped content...
 *   ctx.endClip();
 *
 * It carries no paint, only the outline: what a shape returns from `clipSelf()` to define both its `clip` boundary and
 * the silhouette its backdrop effects are confined to, so one definition drives every clip the node needs.
 */
export class Clip {
    private _ops: ClipOp[] = [];

    rect(state: Partial<RectState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "rect", state });
        return this;
    }

    ellipse(state: Partial<EllipseState> & ShapeAlignmentInput): this {
        this._ops.push({ kind: "ellipse", state });
        return this;
    }

    /** Add a vector path to the clip region, from a `PathState` or a `PathBuilder`. */
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

    /** Uses the last-declared shape as a cutter: unions the shapes before it and subtracts that one, punching a hole. Mirrors {@link Graphics2D.cut}. */
    cut(): this {
        this._ops.push({ kind: "cut" });
        return this;
    }

    /** The recorded ops, in order. Consumed by `RenderContext2D.beginClip()`. */
    ops(): readonly ClipOp[] {
        return this._ops;
    }

    /** True when no shape op has been recorded — the clip region is empty. */
    isEmpty(): boolean {
        return !this._ops.some((op) => op.kind !== "cut");
    }
}
