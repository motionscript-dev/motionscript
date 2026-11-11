import { TransformState } from "./transform";
import { AlignmentKey, Alignment, alignmentOps } from "@/attributes/layout/alignment";
import { Vector2 } from "@/attributes/layout/vector2";

/** Per-shape descriptor state. Shapes carry geometry and a local transform (`rotation`/`scale` baked into the path before it joins the union) but not layer effects: effects, opacity and blend apply to the whole drawn union via {@link Graphics2D.effects}, `Graphics2D.opacity()` and the node, so `ShapeState` omits those `TransformState` fields. */
export interface ShapeState extends Omit<TransformState, "effects" | "pivot" | "opacity" | "blend"> {
    start: number;
    end: number;
    /** Pivot for the shape's local rotation/scale: a named alignment (`.rect({ pivot: 'topRight' })`) or an explicit `Vector2`. `with*Descriptor` normalises it via {@link resolveShapePivot}, so resolved state always carries a concrete pivot. */
    pivot: Alignment;
}

/** Normalises a `pivot` input to a `Vector2` (a named alignment to its `[-1, 1]` pivot; default centre). Idempotent, so both `with*Descriptor` and the renderer can call it. */
export function resolveShapePivot(pivot: Alignment | undefined): Vector2 {
    return alignmentOps.resolve(pivot ?? { x: 0, y: 0 });
}

// Cardinal-alignment positioning: a shape can be placed by a named alignment instead of its centre `x`/`y`, like a
// node (`.rect({ topRight: { x, y }, width, height })`). Targets are in the same y-UP author space as `x`/`y`.
// As with a node, an alignment also sets the shape's `pivot`, so a later `rotation`/`scale` turns about the pinned corner.

/** The cardinal-alignment positioning props a descriptor accepts (input-only, absent from the resolved `*State`). Pass at most one, and not with `x`, `y` or `pivot`; each value is the y-up point the alignment lands on. */
export interface ShapeAlignmentInput {
    center?: Vector2;
    topLeft?: Vector2;
    topRight?: Vector2;
    bottomLeft?: Vector2;
    bottomRight?: Vector2;
    topCenter?: Vector2;
    bottomCenter?: Vector2;
    centerLeft?: Vector2;
    centerRight?: Vector2;
}

export const SHAPE_ALIGNMENT_KEYS: AlignmentKey[] = [
    "center", "topLeft", "topRight", "bottomLeft", "bottomRight",
    "topCenter", "bottomCenter", "centerLeft", "centerRight",
];

/** Validates a descriptor's alignment usage like `alignmentOps.validateProps`, also rejecting `x`/`y`. Throws on more than one alignment, or an alignment combined with `pivot`, `x` or `y`. */
export function validateShapeAlignmentProps(descriptor: Record<string, unknown>): void {
    const present = SHAPE_ALIGNMENT_KEYS.filter(k => descriptor[k] !== undefined);
    if (present.length > 1) {
        throw new Error(`Cannot set multiple shape alignment props at once: ${present.join(", ")}`);
    }
    if (present.length === 1) {
        const conflict = (["pivot", "x", "y"] as const).find(k => descriptor[k] !== undefined);
        if (conflict) {
            throw new Error(`Cannot set both shape alignment prop '${present[0]}' and '${conflict}' at the same time`);
        }
    }
}

/** Drops the input-only alignment keys so a `{ ...descriptor }` spread doesn't leak them onto the resolved `*State` (its x/y/pivot already carry their effect). Shallow copy. */
export function stripShapeAlignmentKeys<T extends object>(descriptor: T): Omit<T, keyof ShapeAlignmentInput> {
    const out = { ...descriptor } as Record<string, unknown>;
    for (const k of SHAPE_ALIGNMENT_KEYS) delete out[k];
    return out as Omit<T, keyof ShapeAlignmentInput>;
}

/**
 * Resolves a descriptor's positioning into a concrete centre `x`/`y` and `pivot` (y-up author space), handling the
 * alignment shorthand: the centre that lands alignment `a` on `target` is `target - a * (size / 2)`, and `pivot`
 * becomes `a` (as `Node2D`'s auto-pivot). Otherwise `x`/`y`/`pivot` pass through; `pivot` alone never repositions
 * here, because this re-runs on already-resolved state (`BaseShape.resolveState`) and would double-apply it. The
 * `pivot` + plain `x`/`y` shorthand ({@link resolvePivotPosition}) bakes its offset in once, earlier, to preserve that.
 */
export function resolveShapeAlignment(
    descriptor: Partial<ShapeState> & ShapeAlignmentInput,
    width: number,
    height: number,
): { x: number; y: number; pivot: Alignment } {
    validateShapeAlignmentProps(descriptor as Record<string, unknown>);

    const alignmentKey = SHAPE_ALIGNMENT_KEYS.find(k => (descriptor as Record<string, unknown>)[k] !== undefined);
    if (alignmentKey) {
        const target = (descriptor as Record<string, Vector2>)[alignmentKey];
        const a = alignmentOps.resolve(alignmentKey); // normalised [-1,1], y-up
        return {
            x: target.x - a.x * (width / 2),
            y: target.y - a.y * (height / 2),
            pivot: a,
        };
    }

    return {
        x: descriptor.x ?? 0,
        y: descriptor.y ?? 0,
        pivot: descriptor.pivot ?? { x: 0, y: 0 },
    };
}

/**
 * Folds a plain `pivot` + `x`/`y` into an equivalent resolved centre, so `{ x, y, pivot: 'topRight' }` lands the
 * top-right corner at `(x, y)` like `{ topRight: { x, y } }`, using the same `target - a * (size / 2)` formula.
 *
 * Must run exactly once, on the raw author-facing descriptor and before {@link resolveShapeAlignment} (in
 * `flipPositionY`, not `with*Descriptor`): `BaseShape.resolveState` re-runs the latter on resolved state, where
 * this output is indistinguishable from a plain descriptor and would double the offset. No-op with an alignment present or a centre/absent `pivot`.
 */
export function resolvePivotPosition<T extends Partial<ShapeState> & ShapeAlignmentInput>(
    descriptor: T,
    width: number,
    height: number,
): T {
    const alignmentKey = SHAPE_ALIGNMENT_KEYS.find(k => (descriptor as Record<string, unknown>)[k] !== undefined);
    if (alignmentKey || descriptor.pivot === undefined) return descriptor;

    const a = alignmentOps.resolve(descriptor.pivot); // normalised [-1,1], y-up
    if (a.x === 0 && a.y === 0) return descriptor;

    const target = { x: descriptor.x ?? 0, y: descriptor.y ?? 0 };
    return {
        ...descriptor,
        x: target.x - a.x * (width / 2),
        y: target.y - a.y * (height / 2),
        pivot: a,
    };
}
