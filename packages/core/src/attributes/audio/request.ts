import { effectsKey, type AudioEffect } from "@/attributes/audio/effects/union";
import { paramKey, type Param } from "@/attributes/audio/ramp";
import { transitionKey, type AudioTransition } from "@/attributes/audio/transition";

/**
 * One bus a clip's signal passes through on its way to the master.
 *
 * A flattened snapshot of an {@link AudioBus} node, not a reference to it: core
 * describes what the graph should be and a platform builds it, so what crosses
 * that seam has to be plain data.
 *
 * {@link id} is what makes it a *bus* rather than per-clip processing — two
 * clips naming the same id share one live chain, so a reverb on a bus is a
 * single tail fed by both, which is not the same sound as that reverb applied
 * to each clip separately.
 */
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
    /**
     * When the bus is present, in the same seconds as the request carrying the
     * stop: what a ramp in {@link volume} or {@link effects}, and its
     * transitions, run over, as a clip's run over the clip. Not the clip's span, because one bus
     * feeds many clips and its fade has to mean one thing to all of them.
     */
    startAt: number;
    endAt: number;
}

/**
 * Everything about a stop that changes what passes through it, as a string — so
 * a device can tell an edited bus from the one it already built.
 */
export function busStopKey(stop: AudioBusStop): string {
    return `${stop.id}:${paramKey(stop.volume)}:${paramKey(stop.pan)}:${stop.mute ? 1 : 0}:${effectsKey(stop.effects)}:${transitionKey(stop.transitionIn)}:${transitionKey(stop.transitionOut)}:${stop.startAt}:${stop.endAt}`;
}

export interface AudioParams {
    src: string;
    volume?: Param;
    loop?: boolean;
    trimStart?: number; // in seconds
    trimEnd?: number; // in seconds
    effects?: AudioEffect[];
}

export interface AudioRequest {
    id: string;
    /** The asset path or URL. ('src' is standard for media) */
    src: string;

    // --- Timeline Synchronization (Clip Time) ---

    /** The clip timestamp when the audio should START playing. */
    startAt: number; // in seconds

    /**
     * The clip timestamp when the audio should STOP playing.
     *
     * Always a number, and **`Infinity` is the open/unbounded sentinel** — never
     * `null` or `undefined`. An unstopped clip carries `Infinity` until
     * {@link open} resolution pins it to the project end.
     *
     * So test it with `Number.isFinite(endAt)`. A `?? Infinity` or `!== null`
     * guard is dead code that reads as if the field were nullable.
     */
    endAt: number; // in seconds

    /**
     * True when this request was started and left running at its scene's end —
     * neither explicitly stopped nor finite-trimmed. Open requests
     * are exempt from the per-scene audio clamp and instead **continue across scene
     * boundaries**: `assembleTimeline` shifts them to absolute time and resolves
     * `endAt = min(startAt + mediaDuration, projectTotalDuration)` (a looped open
     * request runs to the project end). Bounded requests are unaffected.
     */
    open?: boolean;

    /**
     * Source media length in seconds, carried on **open** requests so the
     * cross-scene end can be resolved at assembly time without re-reading the
     * asset catalog. Ignored for bounded requests.
     */
    mediaDuration?: number;

    // --- Media Trimming (Local Audio Time) ---

    /** Offset in seconds to skip ahead in the audio file. Default: 0 */
    trimStart: number;

    /**
     * Out-point inside the source, in seconds, carried **only by a looping
     * request that has one** (`trimEnd` greater than {@link trimStart}). A device
     * loops the region `[trimStart, trimEnd)` rather than the whole buffer; for a
     * request that does not loop, {@link endAt} already ends playback at the
     * out-point and this is absent.
     */
    trimEnd?: number;

    // --- Playback Settings ---

    /** Linear gain over the clip's own seconds. Default 1. */
    volume: Param;
    /** Playback rate, default 1. A ramp runs over the first {@link sourceLength} source seconds after `trimStart`. */
    speed?: Param;
    /** The source seconds a speed ramp is placed on; carried only with one, so the device and the timeline place it alike. */
    sourceLength?: number;
    loop: boolean;  // Default: false

    // --- Processing ---

    /** Audio effects applied in array order (index 0 closest to the source). */
    effects?: AudioEffect[];
    /** A gain over the clip's first and last seconds, on top of {@link volume}. */
    transitionIn?: AudioTransition;
    transitionOut?: AudioTransition;

    /**
     * The buses this clip feeds, **source-adjacent first** — the same ordering
     * convention {@link effects} uses, so the whole chain reads in signal order:
     * the clip's own effects, then each stop in turn, then the master.
     *
     * Absent means the clip goes straight to the master, which is what every
     * request did before buses existed.
     */
    bus?: readonly AudioBusStop[];

    // --- Timeline attribution (display only) ---

    /**
     * The owner key of the node that declared this request: its document row's
     * id, plus the path below that row for a node a composite built. Lets a
     * timeline draw the waveform on that node's bar. Never affects playback.
     */
    ownerId?: string;

    /**
     * The sound of something that is also a picture — a video's own track. A
     * source only such requests want is silence when it holds no audio, where
     * for a request without this it is a failure to report. Never part of the
     * request's identity: it changes nothing a device plays.
     */
    optional?: boolean;
}