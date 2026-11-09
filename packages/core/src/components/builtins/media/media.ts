import type { Alignment } from "@/attributes/layout/alignment";
import type { InsetsResolved } from "@/attributes/layout/insets";
import type { Vector2 } from "@/attributes/layout/vector2";
import { resolveAudioEffects, type AudioEffectsInput } from "@/attributes/audio/effects/chain";
import type { AudioEffect } from "@/attributes/audio/effects/union";
import type { ImageFit, ImageMatrix, ImageCrop } from "@/attributes/shape/fill/implementations/image";
import { sourceTimeFor, type VideoFillProp, type VideoFillResolved } from "@/attributes/shape/fill/implementations/video";
import { resolveFill, UNSET_MEDIA_FILL } from "@/attributes/shape/fill/registry";
import type { FillProp } from "@/attributes/shape/fill/union";
import { resolveChainAdjustments, type VideoAdjustment } from "@/attributes/shape/filters/chain";
import { lerpFilterArray, type AnyFilter } from "@/attributes/shape/filters/registry";
import { Graphics2D } from "@/render/graphics2d";
import type { NodeOf, Values } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import { internalsOf } from "@/components/factory/views";
import type { RectProps } from "@/components/builtins/geometry/geometry";

/**
 * Video: a rect painted with a playing picture under its fill, and the
 * picture's sound. Its sound plays from `play`; a `video` row with no `play`
 * of its own gets one per segment, or one over its span while it plays.
 */

const video = {
    src: Types.custom<string | undefined>(undefined),
    fit: Types.custom<ImageFit | undefined>(undefined),
    crop: Types.insets,
    zoom: 1,
    anchor: Types.alignment,
    matrix: Types.custom<ImageMatrix | undefined>(undefined),
    filters: Types.custom<VideoAdjustment, AnyFilter[]>([] as never, {
        resolve: (v) => resolveChainAdjustments(v),
        lerp: lerpFilterArray,
    }),
    playing: true,
    timestamp: Types.custom<number | null | undefined>(undefined),
    trimStart: Types.custom<number | undefined>(undefined),
    trimEnd: Types.custom<number | undefined>(undefined),
    speed: Types.custom<number | undefined>(undefined),
    loop: Types.custom<"forward" | "reverse" | "none" | undefined>(undefined),
    duration: Types.custom<number | undefined>(undefined),
    volume: 1,
    muted: false,
    audioEffects: Types.custom<AudioEffectsInput, AudioEffect[]>([] as never, { resolve: (v) => resolveAudioEffects(v) }),
    bus: Types.custom<string | undefined>(undefined),
    segments: Types.custom<readonly VideoSegment[]>([]),
};

type VideoState = Values<typeof video> & { readonly crop: InsetsResolved; readonly anchor: Alignment };

/** Source seconds played by `elapsed` clip seconds into the segments, or `null` without any. */
function playedAt(s: VideoState, elapsed: number): number | null {
    if (s.segments.length === 0) return null;
    let played = 0;
    for (const segment of s.segments) {
        if (elapsed <= segment.at) break;
        played += Math.min(elapsed - segment.at, segment.duration) * (segment.speed ?? s.speed ?? 1);
    }
    return played;
}

function scheduledTimestamp(s: VideoState, elapsed: number): number | undefined {
    const played = playedAt(s, elapsed);
    if (played === null) return undefined;
    const start = s.trimStart ?? 0;
    const first = s.segments[0];
    return sourceTimeFor(played + (first ? first.from - start : 0), start, s.trimEnd ?? Infinity, s.loop, s.duration);
}

const pictures = new WeakMap<object, { readonly key: string; readonly fill: VideoFillResolved }>();

/** The frame to paint, resolved once per change of what it depends on. */
function pictureOf(host: object, s: VideoState, elapsed: number): VideoFillResolved | null {
    if (!s.src) {
        pictures.delete(host);
        return null;
    }
    const scheduled = scheduledTimestamp(s, elapsed);
    const crop = s.crop;
    const anchor = s.anchor as unknown as Vector2;
    const key = [
        s.src, s.fit ?? "", s.zoom, s.playing ? 1 : 0, crop.left, crop.right, crop.top, crop.bottom, anchor.x, anchor.y,
        s.timestamp ?? "", s.trimStart ?? "", s.trimEnd ?? "", s.speed ?? "", s.loop ?? "", s.duration ?? "", scheduled ?? "",
    ].join("|");
    const kept = pictures.get(host);
    if (kept && kept.key === key) return kept.fill;
    const prop: VideoFillProp = {
        type: "video", src: s.src, fit: s.fit, crop: s.crop, zoom: s.zoom, anchor: s.anchor, matrix: s.matrix,
        filters: s.filters as never, playing: s.playing, timestamp: s.timestamp ?? scheduled,
        trimStart: s.trimStart, trimEnd: s.trimEnd, speed: s.speed, loop: s.loop, duration: s.duration,
    };
    const fill = resolveFill(prop as FillProp) as VideoFillResolved;
    pictures.set(host, { key, fill });
    return fill;
}

export const Video = component2d({
    key: "video",
    state: { ...Paint.state, ...Flow.state, ...Corners.state, ...video },
    commands: {
        ...Paint.commands,
        /** Its sound: from `from` in the source for a segment, or as it plays. Cut when the command ends. */
        play: {
            args: {
                from: Types.custom<number | undefined>(undefined),
                volume: Types.custom<number | undefined>(undefined),
                speed: Types.custom<number | undefined>(undefined),
            },
            run: (timeline, state) => {
                const s = state as unknown as VideoState;
                const segment = timeline.args.from !== undefined;
                if (!s.src || s.muted || (!segment && !s.playing)) return timeline.together([]);
                const speed = timeline.args.speed ?? s.speed ?? 1;
                const loop = !segment && (s.loop ?? "none") !== "none";
                return timeline.sound(s.src, {
                    volume: timeline.args.volume ?? s.volume,
                    loop,
                    trimStart: segment ? timeline.args.from : s.trimStart,
                    trimEnd: s.trimEnd,
                    speed,
                    effects: s.audioEffects,
                    bus: s.bus,
                    optional: true,
                    closed: !loop,
                });
            },
        },
    },
    load: (loader, state) => {
        if (!state.src) return;
        loader.fill(resolveFill({
            type: "video", src: state.src, filters: state.filters, trimStart: state.trimStart, trimEnd: state.trimEnd,
        } as unknown as FillProp));
    },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => {
        const s = state as unknown as VideoState & Values<typeof Paint.state> & Values<typeof Corners.state>;
        const picture = pictureOf(internalsOf(ctx).host, s, ctx.time.elapsed);
        const outline = { width: ctx.size.width, height: ctx.size.height, cornerRadius: s.cornerRadius, cornerStyle: s.cornerStyle, start: s.start, end: s.end };
        Paint.draw(ctx, state, Corners.rect(ctx.size, state), {
            fill: [(picture ?? UNSET_MEDIA_FILL), ...state.fill] as never,
            // The overlay lies on the picture only, masked by it.
            overlay: () => (picture
                ? new Graphics2D().mask().rect(outline).fill([picture] as never).applyMask().rect(outline).fill(state.overlay).endMask()
                : null),
        });
    },
});

export type Video = NodeOf<typeof Video>;

// What code building a video names its props as, and the segments it plays.

export interface VideoProps extends RectProps {
    src?: string;
    /** How the (cropped) frame is scaled into the node's bounds. Default 'fill'. */
    fit?: ImageFit;
    /** Window onto the source frame, in fractions of its own size, applied before `fit`. */
    crop?: ImageCrop;
    /** Magnification on top of the fitted scale. `1` (default) is the fitted size. */
    zoom?: number;
    /** The point held fixed as `zoom` scales; also the alignment when it doesn't cover. */
    anchor?: Alignment;
    /** Raw frame→shape matrix; bypasses `crop`/`fit`/`zoom`/`anchor` and the bounds. */
    matrix?: ImageMatrix;
    /** Visual filters applied to the rendered frame (blur, color, posterizeTime, echo, …). */
    filters?: VideoAdjustment;
    /** Whether playback advances with the node's clock (drives both picture and sound). Default true. */
    playing?: boolean;
    /**
     * Explicit source time to show, in seconds. Omit it (the default) and the
     * picture is timed from the moment this node appeared; set it to drive the
     * playhead yourself, and set it to `null` to hand the playhead back to the
     * clock (`set()` merges a partial, so `undefined` won't clear it).
     */
    timestamp?: number | null;
    trimStart?: number;
    trimEnd?: number;
    /** Playback-rate multiplier for both picture and audio. Default 1. */
    speed?: number;
    loop?: 'forward' | 'reverse' | 'none';
    /** Length of one loop cycle, in seconds. Defaults to the trimmed clip length. */
    duration?: number;
    /** Audio volume in [0, 1]. Default 1. */
    volume?: number;
    /** Silence the video's audio track without affecting the picture. Default false. */
    muted?: boolean;
    /** Audio effects applied to the video's sound track (gain, eq, echo, …). */
    audioEffects?: AudioEffectsInput;
    /**
     * The node id of an `AudioBus` in this clip to route the video's sound into.
     *
     * A `Video` is a `Node2D`, so it cannot be parented under a bus the way a
     * `SoundNode` is — its audio is welded to its picture, which has to stay in
     * the visual tree. Naming one instead is what lets a video's dialogue sit on
     * the same bus as everything else, so ducking the whole group is still one
     * edit — and it is the *same* id a `SoundNode` under that bus writes as its
     * `parentId`, rather than a second vocabulary for "which bus". An id matching
     * no bus routes straight to the master, the same as no bus at all.
     */
    bus?: string;
    /**
     * An explicit **playback schedule**: the stretches of this node's own clock
     * during which the clip advances, and where in the source each one starts.
     *
     * Omit it (the default) and playback is what it has always been — the clip
     * runs from the moment the node appears, at `speed`, until it or the node
     * runs out. Give it, and `playing`/`timestamp` are both superseded: the
     * picture takes its source time from whichever segment covers the current
     * `elapsed`, and the sound is scheduled one clip per segment.
     *
     * It exists because a **pause** cannot be expressed any other way. `playing:
     * false` holds the clip's *first* frame, because with playback derived
     * linearly from the clock there is nothing else it could hold; and the sound
     * runs on the node's own clock regardless, so a picture frozen by any means
     * would drift away from it. A schedule states the one thing both halves need
     * and neither could infer — that a paused stretch consumes no source — so
     * they cannot come apart.
     *
     * Still a pure function of the clock, which is the property everything else
     * here is built on: frame *N* is identical however the playhead reached it,
     * so a scrub, a playthrough and an export agree.
     */
    segments?: readonly VideoSegment[];

}

/**
 * One stretch of a {@link Video}'s own clock during which its source advances —
 * see {@link VideoProps.segments}.
 *
 * Trim and loop are applied *on top* of this, by the same code that applies them
 * to unscheduled playback, so a schedule says when the clip is running and the
 * clip's own props go on saying which part of the file it is running through.
 */
export interface VideoSegment {
    /** Second on the node's own clock (`NodeTime.elapsed`) this segment begins. */
    at: number;
    /** Source in-point for it, in seconds. */
    from: number;
    /**
     * How long it runs, in seconds of the node's clock.
     *
     * `Infinity` for a clip left running — the same open sentinel
     * `AudioRequest.endAt` uses — which resolves against the clip's length.
     */
    duration: number;
    /** Playback rate through it. Defaults to the node's own `speed`. */
    speed?: number;
    /** Linear gain for its sound. Defaults to the node's own `volume`. */
    volume?: number;
}
