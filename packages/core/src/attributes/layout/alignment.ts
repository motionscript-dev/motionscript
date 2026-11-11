import { Vector2, lerpVector2 } from "./vector2";
import { BoxBounds } from "@/layout/bounds";
import type { AttributeOps } from "@/attributes/shared/operators";

/** The nine named positions inside a box (`center`, `topLeft`, …), each a per-axis point in `[-1, 1]` (x -1 left … +1 right, y -1 bottom … +1 top: layout's y-up convention). */
export type AlignmentKey =
    | "center"
    | "topLeft"
    | "topRight"
    | "bottomLeft"
    | "bottomRight"
    | "topCenter"
    | "bottomCenter"
    | "centerLeft"
    | "centerRight";

/** A normalised point inside a box: the one type behind every "which point of this thing" prop (`Node2D.pivot`, a container's `align`, a gradient's `center`, an image fill's `anchor`). They keep distinct names because they position different things, but share this `[-1, 1]` y-up space so a value read off one can be handed to another. A named position or a {@link Vector2}. */
export type Alignment = AlignmentKey | Vector2;

const ALIGNMENTS: Record<AlignmentKey, Vector2> = {
    topLeft: { x: -1, y: 1 },
    topCenter: { x: 0, y: 1 },
    topRight: { x: 1, y: 1 },
    centerLeft: { x: -1, y: 0 },
    center: { x: 0, y: 0 },
    centerRight: { x: 1, y: 0 },
    bottomLeft: { x: -1, y: -1 },
    bottomCenter: { x: 0, y: -1 },
    bottomRight: { x: 1, y: -1 },
};

/** The nine named alignment keys in reading order: top row left to right, then
 * the middle row, then the bottom row. */
const ALIGNMENT_KEYS: readonly AlignmentKey[] = Object.keys(ALIGNMENTS) as AlignmentKey[];

// `resolve`'s own logic, pulled out only so the alignment-positioning helpers
// below can reach it without going through a `this`-bound method call.
function resolveOne(value: Alignment): Vector2 {
    if (typeof value === "string") {
        const named = Object.hasOwn(ALIGNMENTS, value) ? ALIGNMENTS[value] : undefined;
        if (!named) {
            throw new Error(`Unknown alignment value: '${value}'`);
        }
        return { ...named };
    }
    return { x: value.x, y: value.y };
}

/** The alignment attribute's op set: `resolve`/`lerp` for `pivot`, `align`, `center` and `anchor`, plus the shared alignment-*positioning* math for `Node2D` (constructor binding and one-shot `to()`): landing a named alignment (pivot `a`, y-up) on a target scene-space point puts the node's centre at `target - a·(size/2)`. */

export type AlignmentOps = {
    /** The nine named keys in reading order, top-left to bottom-right. */
    readonly keys: readonly AlignmentKey[];
    isKey(value: unknown): value is AlignmentKey;
    /** Validates a node's alignment props: at most one named alignment, never combined with an explicit `pivot` (the alignment derives one). */
    validateProps(props: Record<string, unknown>): void;
    findKey(props: Record<string, unknown>): AlignmentKey | undefined;
    /** Resolves a named alignment and the centre offset that lands it on `target` for a concrete layout rect (one-shot `to()`): the pivot plus the absolute `x`/`y` the centre moves to. */
    resolveTargetOnce(alignmentKey: AlignmentKey, rect: BoxBounds, target: Vector2): { pivot: Vector2; x: number; y: number };
    /** Reactive form for the constructor: returns the pivot to write plus `x`/`y` binding callbacks that re-evaluate when the target or the node's layout changes. */
    bindTarget(alignmentKey: AlignmentKey, getTarget: () => Vector2, getRect: () => BoxBounds): { pivot: Vector2; x: () => number; y: () => number };
}
export const alignmentOps: AttributeOps<Alignment, Vector2> & AlignmentOps = {
    resolve: resolveOne,
    lerp: lerpVector2,
    keys: ALIGNMENT_KEYS,

    isKey(value): value is AlignmentKey {
        return typeof value === "string" && Object.hasOwn(ALIGNMENTS, value);
    },

    validateProps(props) {
        const present = ALIGNMENT_KEYS.filter(k => props[k] !== undefined);
        if (present.length > 1) {
            throw new Error(`Cannot set multiple alignment props at once: ${present.join(', ')}`);
        }
        if (present.length === 1 && props['pivot'] !== undefined) {
            throw new Error(`Cannot set both alignment prop '${present[0]}' and 'pivot' at the same time`);
        }
    },

    findKey(props) {
        return ALIGNMENT_KEYS.find(k => props[k] !== undefined);
    },

    resolveTargetOnce(alignmentKey, rect, target) {
        const a = resolveOne(alignmentKey);
        return {
            pivot: a,
            x: target.x - a.x * (rect.width / 2),
            y: target.y - a.y * (rect.height / 2),
        };
    },

    bindTarget(alignmentKey, getTarget, getRect) {
        const a = resolveOne(alignmentKey);
        return {
            pivot: a,
            x: () => getTarget().x - a.x * (getRect().width / 2),
            y: () => getTarget().y - a.y * (getRect().height / 2),
        };
    },
};
