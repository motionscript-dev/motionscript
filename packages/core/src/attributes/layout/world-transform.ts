import { Vector2 } from "./vector2";

/** A node's resolved transform in global (scene-root) space: every field is folded through the full ancestor chain (unlike the parent-relative `x`/`y`), so nodes under different parents compare directly. Positions are y-up like `x`/`y`; read in a reactive callback (`x: () => other().global.topRight.x`) they track this node's and every ancestor's layout/transform. */
/** @internal */
export interface WorldTransform {
    readonly x: number;
    readonly y: number;
    readonly center: Vector2;
    readonly topLeft: Vector2;
    readonly topRight: Vector2;
    readonly bottomLeft: Vector2;
    readonly bottomRight: Vector2;
    readonly topCenter: Vector2;
    readonly bottomCenter: Vector2;
    readonly centerLeft: Vector2;
    readonly centerRight: Vector2;
    /** Sum of this node's and all ancestors' rotations, in degrees clockwise. */
    readonly rotation: number;
    /** Product of this node's and all ancestors' scale factors. */
    readonly scale: number;
    /** Product of this node's and all ancestors' opacities in `[0, 1]`: the effective alpha, matching the renderer's pass-through fold. */
    readonly opacity: number;
}
