import { type MotionBlurEffect, type Vector2, resolveEffectAxis, resolveMotionBlurAlignment } from "@motionscript/core";

/** A motion blur resolved against a node's velocity into a directional smear. */
export interface MotionBlurResolved {
    /** Smear axis in degrees (0 = horizontal), as a directional blur's `angle`. */
    angle: number;
    /** Smear length in px along `angle`. */
    radius: number;
    /** Shutter phase in −1…1: offsets the smear's centre from the node's position. */
    phase: number;
    samples: number;
}

/** Above this `samples` count a shutter steps the smear into discrete taps rather than blurring it continuously. */
export const SAMPLE_THRESHOLD = 32;

/**
 * `velocity · dt` is the node's displacement this frame; `length / 100` the
 * shutter fraction (100% = the whole displacement), scaled per axis by `axis`
 * and by `strength`. Null when the smear would be empty.
 */
export function resolveMotionBlur(effect: MotionBlurEffect, velocity: Vector2, dt: number): MotionBlurResolved | null {
    if (dt <= 0 || effect.strength <= 0 || effect.length <= 0) return null;
    const axis = resolveEffectAxis(effect.axis);
    const shutter = effect.length / 100;
    const sx = velocity.x * dt * axis.x * shutter * effect.strength;
    const sy = velocity.y * dt * axis.y * shutter * effect.strength;
    const radius = Math.hypot(sx, sy);
    if (radius < 0.01) return null;
    return {
        angle: (Math.atan2(sy, sx) * 180) / Math.PI,
        radius,
        phase: resolveMotionBlurAlignment(effect.alignment),
        samples: effect.samples,
    };
}
