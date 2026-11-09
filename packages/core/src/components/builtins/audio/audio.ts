import { lerpParam, type Param } from "@/attributes/audio/ramp";
import type { NodeOf } from "@/components/factory/api";
import { componentAudio } from "@/components/factory/component-audio";
import { Types } from "@/components/factory/types";
import type { NodeAudioProps } from "@/components/trees/audio/node-audio";

/**
 * The audio built-ins. A sound plays when a command says so: its `play` runs
 * for the command's span, or to the source's end when the command has no length.
 * A document's `sound` row with no `play` of its own gets one over its span.
 */

/** A clip from the catalog, playing into the buses it sits in. */
export const SoundNode = componentAudio({
    key: "sound",
    state: {
        src: Types.custom<string>(undefined as unknown as string),
        trimStart: 0,
        trimEnd: Types.custom<number | undefined>(undefined),
        loop: false,
        speed: Types.custom<Param>(1, { lerp: lerpParam, kind: "audioParam" }),
    },
    allowedChildren: [],
    commands: {
        play: (timeline, state) => timeline.sound(state.src, {
            trimStart: state.trimStart,
            trimEnd: state.trimEnd,
            loop: state.loop,
            volume: state.volume,
            speed: state.speed,
            effects: state.effects,
            transitionIn: state.transitionIn,
            transitionOut: state.transitionOut,
        }),
    },
});

/** A mix of the sounds and buses in it; `solo` silences its siblings. */
export const AudioBus = componentAudio({
    key: "audioBus",
    state: { solo: false },
});

export type SoundNode = NodeOf<typeof SoundNode>;
export type AudioBus = NodeOf<typeof AudioBus>;

// What code building a sound or a bus names its props as.

export interface AudioBusProps extends NodeAudioProps {
    /** Silence every other bus that is not itself soloed. */
    solo: boolean;
}

export interface SoundNodeProps extends NodeAudioProps {
    /** Path/URL of the audio (or video) asset. Must exist in the asset manifest. */
    src: string;
    /** In-point inside the source file, in seconds. Defaults to 0. */
    trimStart: number;
    /** Out-point inside the source file. Defaults to the source's full length. */
    trimEnd: number | undefined;
    /** Repeat the trimmed clip until it is removed. */
    loop: boolean;
    /**
     * Playback-rate multiplier, pitch included: 2 plays twice as fast and takes
     * half the clip time. A ramp runs over source seconds after `trimStart`.
     */
    speed: Param;
}
