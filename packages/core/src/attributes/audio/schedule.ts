import type { AssetCatalog } from "@/assets/catalog";
import { resolveAudioEffects, type AudioEffectsInput } from "./effects/chain";
import { integrateSpeedToClipTime, isRamp, sourceTimeAtClipElapsed, staticValue, type Param } from "./ramp";
import type { AudioTransition } from "./transition";
import type { AudioBusStop, AudioRequest } from "./request";

/** One clip a command's sound plays, in its clip's seconds. */
export interface AudioClip {
    src: string;
    /** When it starts. */
    at?: number;
    /** When it is cut, however much of it is left. */
    until?: number;
    /** In-point inside the source, in seconds. */
    trimStart?: number;
    /** Out-point inside the source. Absent plays to the source's end. */
    trimEnd?: number;
    loop?: boolean;
    volume?: Param;
    /** Playback rate; a ramp runs over source seconds after `trimStart`. */
    speed?: Param;
    effects?: AudioEffectsInput;
    transitionIn?: AudioTransition;
    transitionOut?: AudioTransition;
    /** Source-adjacent first — see {@link AudioRequest.bus}. */
    bus?: readonly AudioBusStop[];
    /** Sound nobody asked for by name — see {@link AudioRequest.optional}. */
    optional?: boolean;
}

function scalarSpeed(speed: number): number {
    return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/**
 * Clip seconds spent playing the first `sourceElapsed` of `sourceLength` source
 * seconds at `speed`. Must match the device's `playbackRate` schedule, or a
 * request ends before or after its sound does.
 */
export function clipTimeAtSource(speed: Param, sourceLength: number, sourceElapsed: number = sourceLength): number {
    if (isRamp(speed)) return integrateSpeedToClipTime(speed, sourceLength, sourceElapsed);
    return Math.max(0, Math.min(sourceElapsed, sourceLength)) / scalarSpeed(speed);
}

/** Inverse of {@link clipTimeAtSource}: the source seconds reached `clipElapsed` clip seconds in. */
export function sourceTimeAtClip(speed: Param, sourceLength: number, clipElapsed: number): number {
    if (isRamp(speed)) return sourceTimeAtClipElapsed(speed, sourceLength, clipElapsed);
    return Math.max(0, Math.min(sourceLength, clipElapsed * scalarSpeed(speed)));
}

/** How long a clip lasts on the timeline: its trimmed source at its speed. `trimEnd` absent plays to `mediaDuration`. */
export function clipDurationOf(clip: { readonly trimStart?: number; readonly trimEnd?: number; readonly speed?: Param }, mediaDuration: number): number {
    const length = Math.max(0, (clip.trimEnd ?? mediaDuration) - (clip.trimStart ?? 0));
    return clipTimeAtSource(clip.speed ?? 1, length);
}

/**
 * The request `clip` schedules.
 *
 * Bounded when it has an end — a trim, or an `until` — and **open** otherwise, so
 * a bed nothing cuts continues across later tracks; see `AudioRequest.open`.
 */
export function requestOf(clip: AudioClip, catalog: AssetCatalog, ownerKey: string, n: number): AudioRequest {
    const at = clip.at ?? 0;
    const until = clip.until ?? Infinity;
    const trimStart = clip.trimStart ?? 0;
    const trimEnd = clip.trimEnd ?? Infinity;
    const loop = clip.loop ?? false;
    const effects = resolveAudioEffects(clip.effects);
    // Read even when the length goes unused: a missing file throws here, as a
    // build error, rather than playing silence.
    const mediaDuration = catalog.getMediaDuration(clip.src);

    let speed = clip.speed ?? 1;
    if (loop && isRamp(speed)) {
        if (process.env.NODE_ENV !== "production") {
            console.warn(`[motionscript] A speed ramp on a looping clip (${clip.src}) has no one source axis to run over; it plays at its start value.`);
        }
        speed = staticValue(speed, 1);
    }
    const sourceLength = Math.max(0, (Number.isFinite(trimEnd) ? trimEnd : mediaDuration) - trimStart);

    const request: AudioRequest = {
        id: `${ownerKey}|${clip.src}|${at}|${n}`,
        src: clip.src,
        startAt: at,
        endAt: Infinity,
        trimStart,
        volume: clip.volume ?? 1,
        speed,
        loop,
        ownerId: ownerKey,
    };
    if (isRamp(speed)) request.sourceLength = sourceLength;
    if (effects.length > 0) request.effects = effects;
    if (clip.transitionIn) request.transitionIn = clip.transitionIn;
    if (clip.transitionOut) request.transitionOut = clip.transitionOut;
    if (clip.bus) request.bus = clip.bus;
    if (clip.optional) request.optional = true;

    // A loop repeats the trimmed region, so a `trimEnd` bounds one pass and says
    // nothing about when the clip stops: only a cut (`until`) ends it, and with
    // none it runs open to the project end like any other bed.
    if (loop && trimEnd > trimStart && Number.isFinite(trimEnd)) request.trimEnd = trimEnd;

    if (loop && Number.isFinite(until)) {
        request.endAt = until;
    } else if (loop) {
        request.open = true;
    } else if (Number.isFinite(trimEnd)) {
        request.endAt = Math.min(until, at + clipTimeAtSource(speed, sourceLength));
    } else {
        const natural = clipTimeAtSource(speed, sourceLength);
        if (Number.isFinite(until)) {
            request.endAt = Math.min(until, at + natural);
        } else {
            request.open = true;
            request.mediaDuration = natural;
        }
    }
    return request;
}
