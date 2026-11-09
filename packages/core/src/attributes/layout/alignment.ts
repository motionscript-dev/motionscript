import { Vector2, lerpVector2 } from "./vector2";
import { BoxBounds } from "@/layout/bounds";
import type { AttributeOps } from "@/attributes/shared/operators";

/**
 * Named positions inside a box: the nine alignment keys (`center`, `topLeft`, …).
 * Each maps to a per-axis point in `[-1, 1]`: x is -1 (left) … +1 (right), y is
 * -1 (bottom) … +1 (top) — the y-up convention used throughout layout.
 */
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

/**
 * A normalised point inside a box — the single value type behind every "which
 * point of this thing" prop: `Node2D.pivot` (what it rotates about), a container's
 * `align` (where children sit), a gradient's `center` (where it emits from) and
 * an image fill's `anchor` (which point of the source meets the box).
 *
 * Those props keep distinct names because they position *different things*; what
 * they share is this type, this `[-1, 1]` y-up space, and this vocabulary — so a
 * value read off one can be handed to another and mean the same place.
 *
 * Accepts a named position (`'center'`) or an explicit {@link Vector2}.
 */
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

/**
 * The alignment attribute's op set: `pivot`, `align`, `center` and `anchor` all
 * use `resolve`/`lerp`. The rest is the shared alignment-*positioning* math for
 * `Node2D` — used by both the constructor (reactive binding form) and a `to()`
 * step (one-shot form): a named alignment (`'topRight'`, `'centerLeft'`, …)
 * resolves to a normalised pivot `a` in `[-1, 1]` (y-up), and landing that
 * alignment on a target scene-space point means the node's centre sits at
 * `target - a·(size/2)` — the inverse of the offset from centre to the
 * alignment. Kept here rather than duplicated between `Node2D`'s constructor
 * and `_prepareStep`.
 */

export type AlignmentOps = {
    /** The nine named keys in reading order, top-left to bottom-right. */
    readonly keys: readonly AlignmentKey[];
    /** Whether `value` is one of the nine named keys — the strings `resolve` accepts. */
    isKey(value: unknown): value is AlignmentKey;
    /** Validate a node's alignment-positioning props: at most one named alignment, and an
     * alignment cannot be combined with an explicit `pivot` (the alignment derives one). */
    validateProps(props: Record<string, unknown>): void;
    /** The first named alignment key present in `props`, or `undefined` if none. */
    findKey(props: Record<string, unknown>): AlignmentKey | undefined;
    /** Resolve a named alignment + the centre offset that lands it on `target`, given a
     * concrete layout rect. Used by the one-shot `to()` path: returns the pivot to
     * apply plus the absolute `x`/`y` the node's centre must move to. */
    resolveTargetOnce(alignmentKey: AlignmentKey, rect: BoxBounds, target: Vector2): { pivot: Vector2; x: number; y: number };
    /** Reactive binding form used by the constructor: given a (possibly dynamic) target
     * accessor and a live layout-rect accessor, returns the pivot to write plus `x`/`y`
     * binding callbacks that re-evaluate whenever the target or the node's layout changes. */
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
