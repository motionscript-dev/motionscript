import { NodeRenderState } from "@/render/render-context2d";
import { Vector2 } from "@/attributes/layout/vector2";

/** Companion for {@link Node2D}'s clock advance and motion sampling: the backward-difference math as a pure function over reused scratch state (the {@link MotionHistory} is created once per node), with no per-frame allocation. Reactive prop reads stay in Node2D's `_sampleMotion`. */

/** Largest frame delta we trust for a velocity estimate (seconds). Larger gaps (scrub/seek) read as "unknown". */
/** @internal */
export const MAX_MOTION_DT = 0.2;

/** Per-node rolling history for the backward-difference velocity estimate: allocated once, mutated in place by {@link sampleMotion}. */
/** @internal */
export interface MotionHistory {
    prevPos: Vector2 | null;
    prevTime: number;
    prevRotation: number;
    prevScale: number;
}

/** Records the current position as the history's previous frame **without** deriving a velocity: the seam a driven scene primes through. A generator scene walks time one `dt` at a time, so its history is the frame before; a driven scene jumps to any frame, so differencing against "wherever the playhead last was" would make velocity depend on how the viewer got there (a quick scrub smears a static node, holding still doesn't, stepping back reads zero). Priming with the position one frame earlier makes it depend on the frame alone. */
/** @internal */
export function primeMotion(
    history: MotionHistory,
    x: number,
    y: number,
    rotation: number,
    scale: number,
    at: number,
): void {
    if (!history.prevPos) history.prevPos = { x, y };
    else { history.prevPos.x = x; history.prevPos.y = y; }
    history.prevTime = at;
    history.prevRotation = rotation;
    history.prevScale = scale;
}

/** Create the zeroed history holder a node keeps for its lifetime. */
/** @internal */
export function createMotionHistory(): MotionHistory {
    return { prevPos: null, prevTime: 0, prevRotation: 0, prevScale: 1 };
}

/** Computes this frame's motion into the reused `state` as a backward difference against `history`, then rolls the history. Velocity is zero when no trustworthy delta exists (first frame, or a non-monotonic jump: only `0 < dt <= MAX` is trusted, so a scrub reads "unknown" not a huge velocity). `x`/`y` are the world position (y-down) from `layoutBounds + x` / `layoutBounds - y`; layout-dependent fields are filled at draw time. */
/** @internal */
export function sampleMotion(
    state: NodeRenderState,
    history: MotionHistory,
    x: number,
    y: number,
    rotation: number,
    scale: number,
    now: number,
): void {
    const dt = now - history.prevTime;
    const prev = history.prevPos;
    if (prev && dt > 0 && dt <= MAX_MOTION_DT) {
        const vx = (x - prev.x) / dt;
        const vy = (y - prev.y) / dt;
        state.dt = dt;
        state.velocity.x = vx;
        state.velocity.y = vy;
        state.speed = Math.hypot(vx, vy);
        state.direction = (Math.atan2(vy, vx) * 180) / Math.PI;
        state.angularVelocity = (rotation - history.prevRotation) / dt;
        state.scaleVelocity = (scale - history.prevScale) / dt;
    } else {
        state.dt = 0;
        state.velocity.x = 0;
        state.velocity.y = 0;
        state.speed = 0;
        state.direction = 0;
        state.angularVelocity = 0;
        state.scaleVelocity = 0;
    }

    if (!prev) history.prevPos = { x, y };
    else { prev.x = x; prev.y = y; }
    history.prevTime = now;
    history.prevRotation = rotation;
    history.prevScale = scale;
}
