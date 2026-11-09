import type { GainEffect } from "./implementations/gain";
import type { HighPassEffect } from "./implementations/highpass";
import type { LowPassEffect } from "./implementations/lowpass";
import type { TremoloEffect } from "./implementations/tremolo";
import type { EchoEffect } from "./implementations/echo";
import { paramKey } from "../ramp";

/** Every concrete audio effect a sound or a bus can carry. */
export type AudioEffect =
    | GainEffect
    | HighPassEffect
    | LowPassEffect
    | TremoloEffect
    | EchoEffect;

/**
 * Equal for two chains exactly when they sound the same. A device keys its
 * playback by it, so an edited effect tears down the stale source rather than
 * playing it until the next stop.
 */
export function effectsKey(effects: readonly AudioEffect[] | undefined): string {
    if (!effects || effects.length === 0) return "";
    return effects.map((f) => {
        switch (f.type) {
            case "gain":
                return `gain:${paramKey(f.value)}`;
            case "highpass":
            case "lowpass":
                return `${f.type}:${paramKey(f.frequency)}:${paramKey(f.q)}`;
            case "tremolo":
                return `tremolo:${paramKey(f.rate)}:${paramKey(f.depth)}`;
            case "echo":
                return `echo:${paramKey(f.delay)}:${paramKey(f.feedback)}:${paramKey(f.mix)}`;
        }
    }).join("|");
}
