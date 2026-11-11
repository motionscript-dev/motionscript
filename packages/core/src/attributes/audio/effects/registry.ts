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
    lerp(from: T, to: T, t: number): T;
    equals(a: T, b: T): boolean;
}

/** Every built-in effect's handler keyed by `type` (a missing one is a type error). Seeded here rather than registered by each effect's module: core is `sideEffects: false`, so a module imported only to run `register` may be dropped by a bundler and the effect would hard-cut instead of interpolating, silently. */
const BUILT_IN_EFFECTS: { [K in AudioEffect["type"]]: AudioEffectData<Extract<AudioEffect, { type: K }>> } = {
    gain: gainEffect,
    highpass: highPassEffect,
    lowpass: lowPassEffect,
    tremolo: tremoloEffect,
    echo: echoEffect,
};

export class AudioEffectRegistry {
    private static registry = new Map<string, AudioEffectData<AudioEffect>>(
        Object.entries(BUILT_IN_EFFECTS) as [string, AudioEffectData<AudioEffect>][],
    );

    /** Throws if the same `type` is registered twice, to catch accidental double-imports. */
    static register<T extends AudioEffect>(type: string, data: AudioEffectData<T>): void {
        if (this.registry.has(type)) {
            throw new Error(`Audio effect "${type}" is already registered`);
        }
        this.registry.set(type, data as AudioEffectData<AudioEffect>);
    }

    static get(type: string): AudioEffectData<AudioEffect> | undefined {
        return this.registry.get(type);
    }

    static has(type: string): boolean {
        return this.registry.has(type);
    }

    /** Interpolates two effects, hard-cutting at t = 0.5 when types differ or are unregistered. */
    static lerp(from: AudioEffect, to: AudioEffect, t: number): AudioEffect {
        if (from.type !== to.type) return t < 0.5 ? from : to;
        const data = this.registry.get(from.type);
        return data ? data.lerp(from, to, t) : (t < 0.5 ? from : to);
    }

    /** Interpolates two effect arrays of possibly different lengths: indices in only one are kept, matched ones lerped pairwise. */
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

export const audioEffectsOps: AttributeOps<AudioEffectsInput, AudioEffect[]> = {
    resolve: resolveAudioEffects,
    lerp: AudioEffectRegistry.lerpArray,
};
