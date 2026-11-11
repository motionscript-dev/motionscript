import { NodeEffect } from "@/attributes/shape/effects/union";
import { NodeBlendMode } from "@/attributes/shape/fill/blend";
import { Vector2 } from "@/attributes/layout/vector2";
import type { Matrix2D } from "@/attributes/layout/matrix2d";

export interface TransformState {
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    /** Layer blend mode. `'pass-through'` (the default) does not isolate the node; any other mode isolates it and blends its flattened result against the backdrop. Optional so per-shape descriptors that extend this state needn't carry it. */
    blend?: NodeBlendMode;
    rotation: number;
    scale: number;
    effects: NodeEffect[];
    /** Pivot point for rotation and scale, in normalised node space. (0,0)=center, (-1,1)=top-left, (1,-1)=bottom-right. */
    pivot: Vector2;
    /**
     * The node's whole local transform, precomposed; present only when the decomposed fields can't express it (a node
     * that mirrors or tilts out of plane: `flipHorizontal`, `rotationX`, `perspective`, ...). A backend **concats it
     * instead of** applying `x`/`y`/`rotation`/`scale`/`pivot`. Defined once in `nodeProjectedMatrix` so every backend
     * gets the same answer; it may carry a perspective row, so it is a full 3x3 ({@link Matrix2D}). It is more than
     * `Node2D._localMatrix` reports: the out-of-plane transform is paint, not geometry.
     */
    matrix?: Matrix2D;
}
