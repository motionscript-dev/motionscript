import { AudioEffect } from "@/attributes/audio/effects/union";
import { type AudioEffectsInput, resolveAudioEffects } from "@/attributes/audio/effects/chain";
import type { AttributeOps } from "@/attributes/shared/operators";
import { gainEffect } from "./implementations/gain";
import { highPassEffect } from "./implementations/highpass";
import { lowPassEffect } from "./implementations/lowpass";
import { tremoloEffect } from "./implementations/tremolo";
import { echoEffect } from "./implementations/echo";

/** Interpolation and equality contract every registered audio effect must implement. */
export interface AudioEffectData<T extends AudioEffect> {
    /** Return a new effect linearly interpolated between `from` and `to` at progress `t` (0–1). */
    lerp(from: T, to: T, t: number): T;
    /** Return true when both effects are audibly identical (used to skip redundant work). */
    equals(a: T, b: T): boolean;
}

/**
 * Every built-in effect's handler, keyed by its `type` — an effect missing here
 * is a type error. Seeded into the registry rather than registered by each
 * effect's own module: core is `sideEffects: false`, so a module imported only
 * to run a `register` call is one a bundler may drop, and the effect it held
 * would then hard-cut instead of interpolating, with nothing raised.
 */
const BUILT_IN_EFFECTS: { [K in AudioEffect["type"]]: AudioEffectData<Extract<AudioEffect, { type: K }>> } = {
    gain: gainEffect,
    highpass: highPassEffect,
    lowpass: lowPassEffect,
    tremolo: tremoloEffect,
    echo: echoEffect,
};

/** Central registry that maps audio-effect type strings to their `AudioEffectData` handlers. */
export class AudioEffectRegistry {
    private static registry = new Map<string, AudioEffectData<AudioEffect>>(
        Object.entries(BUILT_IN_EFFECTS) as [string, AudioEffectData<AudioEffect>][],
    );

    /**
     * Register an effect type.
     * Throws if the same `type` key is registered more than once to catch accidental double-imports.
     */
    static register<T extends AudioEffect>(type: string, data: AudioEffectData<T>): void {
        if (this.registry.has(type)) {
            throw new Error(`Audio effect "${type}" is already registered`);
        }
        this.registry.set(type, data as AudioEffectData<AudioEffect>);
    }

    /** Look up the `AudioEffectData` for a given type key, or `undefined` if not registered. */
    static get(type: string): AudioEffectData<AudioEffect> | undefined {
        return this.registry.get(type);
    }

    /** Return true when an effect type has been registered. */
    static has(type: string): boolean {
        return this.registry.has(type);
    }

    /**
     * Interpolate between two individual effects at progress `t`.
     * Falls back to a hard cut at t = 0.5 when the types differ or are unregistered.
     */
    static lerp(from: AudioEffect, to: AudioEffect, t: number): AudioEffect {
        if (from.type !== to.type) return t < 0.5 ? from : to;
        const data = this.registry.get(from.type);
        return data ? data.lerp(from, to, t) : (t < 0.5 ? from : to);
    }

    /**
     * Interpolate between two effect arrays of potentially different lengths.
     * Indices present in only one array are kept as-is; matched indices are lerped pairwise.
     */
    static lerpArray(from: AudioEffect[], to: AudioEffect[], t: number): AudioEffect[] {
        const maxLen = Math.max(from.length, to.length);
        const result: AudioEffect[] = [];
        for (let i = 0; i < maxLen; i++) {
            const a = from[i];
            const b = to[i];
            if (a && b) {
                result.push(AudioEffectRegistry.lerp(a, b, t));
            } else if (a) {
                result.push(a);
            } else if (b) {
                result.push(b);
            }
        }
        return result;
    }
}

/** The audio-effect-chain attribute's op set — the `effects` prop's resolve/lerp pair. */
export const audioEffectsOps: AttributeOps<AudioEffectsInput, AudioEffect[]> = {
    resolve: resolveAudioEffects,
    lerp: AudioEffectRegistry.lerpArray,
};
