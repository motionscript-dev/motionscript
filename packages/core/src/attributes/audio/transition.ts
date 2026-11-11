import { easeOfSpec, type EaseSpec } from "@/tween/ease/spec";
import type { EasingFunction } from "@/tween/ease/type";

/** What happens as a clip enters (`transitionIn`) or leaves (`transitionOut`): a fade over its first or last `duration` clip seconds. A cross-fade is two overlapping clips, the first with a `transitionOut` and the second a `transitionIn` as long as the overlap; equal-power shapes are complementary, so the pair needs no link. */
export interface AudioTransition {
    readonly duration: number;
    /**
     * Progress through the transition (x, 0→1) to how far it has come (y, the
     * gain for a fade), read as entering; a `transitionOut` plays it backwards.
     * Default `"equalPower"`, sin(πx/2).
     */
    readonly curve?: "equalPower" | EaseSpec;
}

const EQUAL_POWER: EasingFunction = (x) => Math.sin((Math.max(0, Math.min(1, x)) * Math.PI) / 2);
const shapes = new WeakMap<EaseSpec, EasingFunction>();

function shapeOf(transition: AudioTransition): EasingFunction {
    const curve = transition.curve;
    if (curve === undefined || curve === "equalPower") return EQUAL_POWER;
    let shape = shapes.get(curve);
    if (!shape) shapes.set(curve, (shape = easeOfSpec(curve)));
    return shape;
}

/**
 * The two transitions' durations on a clip `length` seconds long: shrunk in
 * proportion when together they would overrun it.
 */
export function transitionSpans(length: number, transitionIn?: AudioTransition, transitionOut?: AudioTransition): { readonly in: number; readonly out: number } {
    const wanted = { in: Math.max(0, transitionIn?.duration ?? 0), out: Math.max(0, transitionOut?.duration ?? 0) };
    if (!Number.isFinite(length)) return { in: wanted.in, out: 0 };
    const total = wanted.in + wanted.out;
    if (total <= length || total === 0) return wanted;
    if (process.env.NODE_ENV !== "production") {
        console.warn(`[motionscript] Transitions of ${total.toFixed(3)}s overrun a ${length.toFixed(3)}s clip; both are shortened to fit.`);
    }
    const scale = Math.max(0, length) / total;
    return { in: wanted.in * scale, out: wanted.out * scale };
}

/**
 * The gain the transitions put on a clip at `t` of its `length` seconds: 1
 * outside both. An open clip (`length` not finite) has no end to leave from.
 */
export function transitionGainAt(t: number, length: number, transitionIn?: AudioTransition, transitionOut?: AudioTransition): number {
    const spans = transitionSpans(length, transitionIn, transitionOut);
    let gain = 1;
    if (transitionIn && spans.in > 0 && t < spans.in) gain *= Math.max(0, shapeOf(transitionIn)(Math.max(0, t) / spans.in));
    if (transitionOut && spans.out > 0 && t > length - spans.out) gain *= Math.max(0, shapeOf(transitionOut)(Math.max(0, length - t) / spans.out));
    return gain;
}

export function transitionKey(transition: AudioTransition | undefined): string {
    if (!transition) return "_";
    return `${transition.duration}:${typeof transition.curve === "object" ? JSON.stringify(transition.curve) : transition.curve ?? "equalPower"}`;
}
