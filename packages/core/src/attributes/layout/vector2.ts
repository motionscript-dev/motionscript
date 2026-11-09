import { lerpNumber } from "@/tween/lerp";
import type { AttributeOps } from "@/attributes/shared/operators";

/** A 2D point or offset in pixel space. */
export interface Vector2 {
    x: number;
    y: number;
}

/** Linear interpolation between two Vector2 positions. t=0 returns `from`, t=1 returns `to`. */
export function lerpVector2(from: Vector2, to: Vector2, t: number): Vector2 {
    return { x: lerpNumber(from.x, to.x, t), y: lerpNumber(from.y, to.y, t) };
}

/** The `Vector2` attribute's op set: resolve is the identity (already a loose number pair). */
export const vector2Ops: AttributeOps<Vector2, Vector2> = {
    resolve: (value) => value,
    lerp: lerpVector2,
};
