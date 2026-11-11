import type { BlendMode } from '../blend';
import type { MediaAdjustment, VideoOnlyAdjustment } from '../../filters/union';
import type { PosterizeTimeFilter } from '../../filters/implementations/posterize-time';
import type { FillData } from '../registry';
import type { ImageCrop, ImageFit, ImageMatrix } from './image';
import { lerpImagePlacement, resolveImagePlacement } from './image';
import type { Alignment } from '@/attributes/layout/alignment';
import type { InsetsResolved } from '@/attributes/layout/insets';
import type { Vector2 } from '@/attributes/layout/vector2';
import { lerpNumber } from '@/tween/lerp';
import {
    declareMediaPreset,
    lerpMediaPreset,
    resolveMediaPreset,
    type MediaPresetResolved,
    type VideoPresetProp,
} from '../media-preset';

/** Adjustments a video fill carries — the pixel ones plus the video-only ones. */
type VideoFillFilter = MediaAdjustment | VideoOnlyAdjustment;

export interface VideoFillProp {
    type: 'video';
    src: string;
    /** How the (cropped) frame is scaled into the node's bounds. Defaults to `'fill'`. */
    fit?: ImageFit;
    crop?: ImageCrop;
    zoom?: number;
    anchor?: Alignment;
    /** Raw frame→shape matrix; wins over everything above. See {@link ImageFillProp.matrix}. */
    matrix?: ImageMatrix;
    /**
     * Source time to paint, in seconds: an **explicit override**. Omitted, the timestamp is derived at draw time from how
     * long the painting node has existed, so a video fill plays wherever paint is accepted. Pass `null` to hand the
     * playhead back to the clock (`Node2D.set` skips `undefined`, so `null` is what un-does a live override).
     */
    timestamp?: number | null;
    /** Whether the derived timestamp advances with the node's clock. Default `true`. */
    playing?: boolean;
    trimStart?: number;
    trimEnd?: number;
    /** Seconds after the painting node appears before playback begins (default `0`), for a fill joining an existing node (a video cross-faded in at 4s would otherwise open 4s into the clip). Negative starts the clip in progress. */
    playStart?: number;
    speed?: number;
    /** The grade laid over this footage — see {@link VideoPresetProp}. */
    preset?: VideoPresetProp;
    loop?: 'forward' | 'reverse' | 'none';
    duration?: number;
    opacity?: number;
    blend?: BlendMode;
}

export interface VideoFillResolved {
    type: 'video';
    src: string;
    fit?: ImageFit;
    crop?: InsetsResolved;
    zoom?: number;
    anchor?: Vector2;
    matrix?: ImageMatrix;
    timestamp?: number | null;
    playing: boolean;
    trimStart?: number;
    trimEnd?: number;
    playStart?: number;
    speed?: number;
    /** Absent when the fill is ungraded — see {@link resolveMediaPreset}. */
    preset?: MediaPresetResolved<VideoFillFilter>;
    loop?: 'forward' | 'reverse' | 'none';
    duration?: number;
    opacity?: number;
    blend?: BlendMode;
}

/**
 * The source time a video fill paints at, given `elapsed` (how long the painting node has existed). A pure function of
 * the fill and the clock, derived at draw time rather than advanced per tick, so a video plays anywhere paint is
 * accepted (stroke, shadow, text run, raw `Graphics2D`) and frame N is identical however the playhead reached it.
 * `sourceDuration` resolves the `trimEnd` default and loop cycle; when unknown (non-positive or `undefined`) playback
 * runs linearly and unlooped.
 */
export function resolveVideoTimestamp(
    fill: VideoFillResolved,
    elapsed: number,
    sourceDuration?: number,
): number {
    const start = fill.trimStart ?? 0;
    return posterizeTimestamp(fill, start, rawTimestamp(fill, elapsed, sourceDuration, start));
}

/** {@link resolveVideoTimestamp} before the posterize-time quantization. */
function rawTimestamp(
    fill: VideoFillResolved,
    elapsed: number,
    sourceDuration: number | undefined,
    start: number,
): number {
    // An authored timestamp wins outright: the author is driving the playhead.
    if (fill.timestamp != null) return fill.timestamp;
    // Paused with no authored time: hold the clip's first frame.
    if (!fill.playing) return start;

    const played = Math.max(0, elapsed - (fill.playStart ?? 0)) * (fill.speed ?? 1);
    return sourceTimeFor(played, start, trimEndFor(fill, sourceDuration), fill.loop, fill.duration);
}

/** The clip's out point: the fill's own, else the source's length once the container is open, else unbounded. `Infinity` is the unbounded sentinel, as on the audio side (`Sound.trimEnd`, `AudioRequest.endAt`). */
export function trimEndFor(
    fill: Pick<VideoFillResolved, 'trimEnd'>,
    sourceDuration: number | undefined,
): number {
    const hasDuration = sourceDuration !== undefined && Number.isFinite(sourceDuration) && sourceDuration > 0;
    return fill.trimEnd ?? (hasDuration ? sourceDuration : Infinity);
}

/** Where `played` seconds of *consumed source* land inside the trimmed window after looping and clamping. Shared by the fill (linear in the clock) and a {@link Video} node on a `segments` schedule (a paused stretch consumes no source), so what "wraps" and "stops" mean lives once. */
export function sourceTimeFor(
    /** Seconds of source consumed so far — already scaled by playback rate. */
    played: number,
    start: number,
    /** The trim-out point, or `Infinity` while the source's length is unknown. */
    end: number,
    loop: 'forward' | 'reverse' | 'none' | undefined,
    /** An explicit loop-cycle length; defaults to the trimmed clip's own. */
    cycleLength?: number,
): number {
    const rawLoopDuration = cycleLength ?? (end !== Infinity ? end - start : undefined);
    const loopDuration = rawLoopDuration !== undefined && rawLoopDuration > 0 ? rawLoopDuration : undefined;
    if ((loop ?? 'none') !== 'none' && loopDuration !== undefined) {
        const cycle = played % loopDuration;
        if (loop === 'reverse') {
            const ping = Math.floor(played / loopDuration) % 2 === 0;
            return start + (ping ? cycle : loopDuration - cycle);
        }
        return start + cycle;
    }
    const linear = start + played;
    return end !== Infinity ? Math.min(linear, end) : linear;
}

/** Posterize Time: snaps the source timestamp to a coarser grid, holding each frame a full 1/fps (`floor`, not round, matching After Effects). Done after trim/speed/loop so it lines up with the adapter's decoded-frame grid. */
function posterizeTimestamp(fill: VideoFillResolved, start: number, timestamp: number): number {
    const posterize = fill.preset?.adjustments.find(
        (f): f is PosterizeTimeFilter => f.type === 'posterizeTime',
    );
    if (!posterize || posterize.fps <= 0) return timestamp;
    const grid = 1 / posterize.fps;
    return start + Math.floor((timestamp - start) / grid) * grid;
}

export const videoFill: FillData<VideoFillResolved> = {
    // See `imageFill.resolve` for why `crop`/`anchor` are destructured out.
    resolve: ({ crop, anchor, preset, ...prop }: VideoFillProp): VideoFillResolved => ({
        ...prop,
        ...resolveImagePlacement({ crop, anchor }),
        preset: resolveMediaPreset(preset) as
            | MediaPresetResolved<VideoFillFilter>
            | undefined,
        playing: prop.playing ?? true,
    }),
    lerp: (a, b, t) => ({
        src: t < 0.5 ? a.src : b.src,
        fit: t < 0.5 ? a.fit : b.fit,
        ...lerpImagePlacement(a, b, t),
        loop: t < 0.5 ? a.loop : b.loop,
        duration: t < 0.5 ? a.duration : b.duration,
        trimStart: t < 0.5 ? a.trimStart : b.trimStart,
        trimEnd: t < 0.5 ? a.trimEnd : b.trimEnd,
        playStart: t < 0.5 ? a.playStart : b.playStart,
        playing: t < 0.5 ? a.playing : b.playing,
        opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t,
        // Both derived stays derived: lerping `?? 0` would pin the result to an explicit timestamp and freeze the clip while the tween is live.
        timestamp: a.timestamp == null && b.timestamp == null
            ? undefined
            : lerpNumber(a.timestamp ?? 0, b.timestamp ?? 0, t),
        speed: lerpNumber(a.speed ?? 1, b.speed ?? 1, t),
        // See the note on `imageFill.lerp` — without this the *from* fill's
        // grade rides the whole tween and snaps at the end.
        preset: lerpMediaPreset(a.preset, b.preset, t),
    }),
    equals: (a, b) => a.src === b.src,
    declare: (fill, assets) => {
        assets.video(fill.src, { start: fill.trimStart ?? 0, end: fill.trimEnd });
        declareMediaPreset(fill.preset, assets);
    },
};
