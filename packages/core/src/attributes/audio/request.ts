import { effectsKey, type AudioEffect } from "@/attributes/audio/effects/union";
import { paramKey, type Param } from "@/attributes/audio/ramp";
import { transitionKey, type AudioTransition } from "@/attributes/audio/transition";

/** One bus a clip's signal passes through to the master: a flattened snapshot of an {@link AudioBus} node (core describes the graph, a platform builds it). {@link id} makes it a *bus* rather than per-clip processing: clips naming the same id share one live chain, so a bus reverb is one tail fed by both. */
export interface AudioBusStop {
    id: string;
    /** Linear gain. A {@link Param}, so a bus fade is a ramp rather than a per-frame write. */
    volume: Param;
    /** -1 hard left … +1 hard right. */
    pan: Param;
    mute: boolean;
    /** Applied in array order, index 0 closest to the source. */
    effects?: AudioEffect[];
    transitionIn?: AudioTransition;
    transitionOut?: AudioTransition;
    /** When the bus is present, in the same seconds as the request carrying the stop: what ramps in {@link volume} or {@link effects} (and their transitions) run over. Not the clip's span, because one bus feeds many clips and its fade must mean one thing to all. */
    startAt: number;
    endAt: number;
}

/** Everything about a stop that changes what passes through it, as a string, so a device can tell an edited bus from the one it built. */
export function busStopKey(stop: AudioBusStop): string {
    return `${stop.id}:${paramKey(stop.volume)}:${paramKey(stop.pan)}:${stop.mute ? 1 : 0}:${effectsKey(stop.effects)}:${transitionKey(stop.transitionIn)}:${transitionKey(stop.transitionOut)}:${stop.startAt}:${stop.endAt}`;
}

export interface AudioRequest {
    id: string;
    src: string;

    /** The clip timestamp when the audio should START playing. */
    startAt: number; // in seconds

    /** The clip timestamp when the audio STOPS. Always a number: **`Infinity` is the open sentinel**, never null/undefined (an unstopped clip carries it until {@link open} resolution pins it to the project end). Test with `Number.isFinite(endAt)`; a `?? Infinity` guard is dead code. */
    endAt: number; // in seconds

    /** True when started and left running at its scene's end (neither stopped nor finite-trimmed). Open requests skip the per-scene audio clamp and **continue across scene boundaries**: `assembleTimeline` shifts them to absolute time and resolves `endAt = min(startAt + mediaDuration, projectTotalDuration)`. */
    open?: boolean;

    /** Source media length, carried on **open** requests so the cross-scene end resolves at assembly without re-reading the catalog. Ignored for bounded requests. */
    mediaDuration?: number;

    /** Offset in seconds to skip ahead in the audio file. Default: 0 */
    trimStart: number;

    /** Out-point inside the source in seconds, carried **only by a looping request that has one**: a device loops `[trimStart, trimEnd)` instead of the whole buffer. Otherwise {@link endAt} already ends playback there and this is absent. */
    trimEnd?: number;

    /** Linear gain over the clip's own seconds. Default 1. */
    volume: Param;
    /** Playback rate, default 1. A ramp runs over the first {@link sourceLength} source seconds after `trimStart`. */
    speed?: Param;
    /** The source seconds a speed ramp is placed on; carried only with one, so the device and the timeline place it alike. */
    sourceLength?: number;
    loop: boolean;  // Default: false

    /** Audio effects applied in array order (index 0 closest to the source). */
    effects?: AudioEffect[];
    /** A gain over the clip's first and last seconds, on top of {@link volume}. */
    transitionIn?: AudioTransition;
    transitionOut?: AudioTransition;

    /** The buses this clip feeds, **source-adjacent first** like {@link effects}, so the chain reads in signal order: clip effects, each stop, then master. Absent goes straight to the master. */
    bus?: readonly AudioBusStop[];

    /** The owner key of the declaring node (its document row's id, plus the path below that row for a composite's node), so a timeline can draw the waveform on that node's bar. Never affects playback. */
    ownerId?: string;

    /** The sound of something that is also a picture (a video's own track): a source with no audio is silence for such a request, not a failure. Not part of the request's identity. */
    optional?: boolean;
}