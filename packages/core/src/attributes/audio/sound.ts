import type { AudioEffect } from "@/attributes/audio/effects/union";
import { type AudioEffectsInput, resolveAudioEffects } from "@/attributes/audio/effects/chain";
import type { Param } from "@/attributes/audio/ramp";
import { clipTimeAtSource } from "@/attributes/audio/schedule";

interface SoundPropsBase {
    src: string;
    volume?: Param;
    /** Playback rate; a ramp runs over source seconds after `trimStart`. */
    speed?: Param;
    loop?: boolean;
    /** Audio effects applied to the clip (gain, eq, tremolo, echo). */
    effects?: AudioEffectsInput;
}

/**
 * Author-facing sound props. Two mutually-exclusive ways to bound the clip:
 *
 * - `{ trimStart?, trimEnd? }` — explicit in/out points into the source file.
 * - `{ duration? }` — syntax sugar for a clip that runs `duration` seconds from
 *   the start (equivalent to `trimStart: 0, trimEnd: duration`).
 *
 * When neither `trimEnd` nor `duration` is given, the clip runs to the source's
 * full length (resolved from the asset catalog). `trimStart` defaults to 0.
 */
export type SoundProps =
    | (SoundPropsBase & { trimStart?: number; trimEnd?: number; duration?: undefined })
    | (SoundPropsBase & { duration?: number; trimStart?: undefined; trimEnd?: undefined });

/** Canonical, fully-resolved sound props. `trimEnd` is resolved against the catalog. */
export interface ResolvedSoundProps {
    src: string;
    volume?: Param;
    speed?: Param;
    loop?: boolean;
    trimStart?: number;
    trimEnd?: number;
    effects?: AudioEffect[];
}

/**
 * A clip's resolved props, and how long it runs. What a node plays is declared
 * through `declareAudio`; this is only the arithmetic over one clip.
 */
export class Sound {
    readonly src: string;
    volume: Param;
    speed: Param;
    loop: boolean;
    trimStart: number;
    trimEnd: number;
    effects: AudioEffect[];

    constructor(props: SoundProps) {
        this.src = props.src;
        this.volume = props.volume ?? 1;
        this.speed = props.speed ?? 1;
        this.loop = props.loop ?? false;
        // `duration` is sugar for `trimStart: 0, trimEnd: duration`.
        this.trimStart = props.trimStart ?? 0;
        this.trimEnd = props.trimEnd ?? props.duration ?? Infinity;
        this.effects = resolveAudioEffects(props.effects);
    }

    /** Clip seconds `trimmedSourceLength` source seconds take at this clip's speed. */
    clipDurationFor(trimmedSourceLength: number): number {
        return clipTimeAtSource(this.speed, trimmedSourceLength);
    }

    /** @deprecated Renamed to {@link clipDurationFor}; kept until 1.0. */
    sceneDurationFor(trimmedSourceLength: number): number {
        return this.clipDurationFor(trimmedSourceLength);
    }

    /** Clip seconds, speed profile applied; `undefined` when nothing bounds the clip. */
    get clipDuration(): number | undefined {
        return this.trimEnd !== Infinity
            ? this.clipDurationFor(this.trimEnd - this.trimStart)
            : undefined;
    }
}
