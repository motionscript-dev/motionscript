import type { AssetCatalog } from "@motionscript/core";
import type { AudioMixer, ScheduledAudioRequest } from "../frame-loop";
import { fetchAssetBytes, localAssetBytes } from "../asset-bytes";
import { AudioBusGraph } from "./bus-graph";
import { applyLoop } from "./loop-region";
import { applySpeedToPlaybackRate, buildAudioEffectGraph, buildLevel, playbackOf, sourceOffsetOf } from "./effect-graph";

/** Sample rate used when the caller doesn't pick one. */
export const DEFAULT_SAMPLE_RATE = 44100;

export interface MixAudioOptions {
    /** Defaults to {@link DEFAULT_SAMPLE_RATE}. */
    sampleRate?: number;
    /**
     * Resolves a request's `src` to the address its bytes live at, as the storage
     * adapter does for the live paths. Omitted, a `src` is
     * fetched as written — right only while the host keys its manifest by URL.
     */
    catalog?: AssetCatalog;
}

/** Audio first, then video: a clip's own soundtrack is requested under the video's key. */
function audioUrl(src: string, catalog: AssetCatalog | undefined): string {
    if (!catalog) return src;
    try {
        return catalog.getAudioMeta(src).src || src;
    } catch {
        try {
            return catalog.getVideoMeta(src).src || src;
        } catch {
            return src;
        }
    }
}

/**
 * Reads and decodes an audio source against a scratch `OfflineAudioContext`
 * (decoding requires a context but doesn't render through it). The host's byte
 * source is asked first, as for every other asset read: a mix that went to the
 * network would fail where the preview played, offline or for bytes not yet
 * uploaded.
 */
async function fetchAudioBuffer(src: string, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const blob = (await localAssetBytes(src)) ?? (await fetchAssetBytes(src));
    return ctx.decodeAudioData(await blob.arrayBuffer());
}

/**
 * Render every scheduled request into one timeline-length buffer.
 *
 * An `OfflineAudioContext` graph — gain per request, looping/trimming, and the
 * same filter chain the live {@link WebAudioSink} builds — rendered in one
 * pass rather than scheduled per frame.
 *
 * Shared by the video exporter and by `mixTimelineAudio`, deliberately: a split
 * export and a whole one have to be the same mix, and two implementations of
 * "stack these clips" would eventually disagree.
 *
 * Curve-valued filter params and `speed` curves schedule here exactly as they do
 * in {@link WebAudioSink.playBuffer}, which is the reference implementation —
 * the two must be read side by side when either changes.
 *
 * One deliberate difference: this schedules at absolute context times, so clip
 * starts are sample-accurate here and quantized to `1/fps` in live playback,
 * which starts sources at `currentTime` on a clock tick.
 */
export async function mixAudio(
    requests: readonly ScheduledAudioRequest[],
    totalDuration: number,
    options: MixAudioOptions = {},
): Promise<AudioBuffer | null> {
    if (requests.length === 0) return null;
    const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const frames = Math.ceil(totalDuration * sampleRate);
    if (frames <= 0) return null;

    const uniqueSrcs = [...new Set(requests.map(r => r.request.src))];
    const scratchCtx = new OfflineAudioContext(2, frames, sampleRate);

    // A source only a picture's own sound wants may hold no audio at all, which
    // is silence rather than a failed mix — see `AudioRequest.optional`.
    const asked = new Set(requests.filter(r => !r.request.optional).map(r => r.request.src));
    const decoded = new Map<string, AudioBuffer>();
    await Promise.all(uniqueSrcs.map(async (src) => {
        try {
            decoded.set(src, await fetchAudioBuffer(audioUrl(src, options.catalog), scratchCtx));
        } catch (cause) {
            if (asked.has(src)) throw cause;
        }
    }));

    const mixCtx = new OfflineAudioContext(2, frames, sampleRate);
    // The same shared-chain rule the live device uses, for the same reason: an
    // export that flattened buses into per-clip processing would not match what
    // the preview sounded like.
    const buses = new AudioBusGraph(mixCtx, mixCtx.destination);

    for (const { request: req, globalOffset } of requests) {
        const srcBuffer = decoded.get(req.src);
        if (!srcBuffer) continue;

        const globalStart = globalOffset + req.startAt;
        // `endAt` is `Infinity` for an open clip; either way the timeline bounds it.
        const globalEnd = Math.min(globalOffset + req.endAt, totalDuration);
        const playDuration = globalEnd - globalStart;
        if (playDuration <= 0) continue;

        const source = mixCtx.createBufferSource();
        source.buffer = srcBuffer;
        applyLoop(source, req);

        // Ramps resolve against the clip's own length, deliberately *not*
        // `playDuration`, which is that length truncated by the timeline end:
        // resolving against the truncated value would squeeze the whole ramp
        // into the surviving part instead of cutting it off. `elapsed` is 0:
        // unlike a live seek, the mix always starts a clip at its beginning.
        const playback = playbackOf(req, srcBuffer.duration);
        if (playback.rate !== 1) source.playbackRate.value = playback.rate;
        applySpeedToPlaybackRate(
            source.playbackRate, playback.speedRamp, playback.sourceLength, playback.clipDuration, globalStart, 0,
        );

        // The same chain as the live WebAudioSink graph, so exports sound like the preview.
        const graph = buildAudioEffectGraph(mixCtx, source, req.effects ?? [], globalStart, playback.clipDuration, 0);
        const level = buildLevel(mixCtx, graph.output, req, playback, globalStart, 0);
        // From the mix's start, whichever clip asks first: a bus's chain is shared,
        // so its schedule cannot begin at one clip's start. Context time 0 is
        // `-globalOffset` in this request's seconds, which are its stops' too.
        level.output.connect(buses.inputFor(req.bus, 0, -globalOffset));

        // start()'s 3rd arg is a source-buffer duration: under a speed ramp the
        // buffer consumed over a span of clip time is the integral of the rate,
        // not a multiple of it.
        const consumed = sourceOffsetOf(playback, playDuration);

        source.start(globalStart, req.trimStart, consumed);
        for (const osc of graph.oscillators) osc.start(globalStart);
    }

    return mixCtx.startRendering();
}

/**
 * Adapter presenting {@link mixAudio} as the exporter's injected mixer seam.
 *
 * The sample rate is a constructor argument rather than a third `mix` parameter
 * because {@link AudioMixer} — the seam `renderTimeline` calls through — takes
 * exactly two, so anything passed as a third would be silently dropped. Fixing
 * it here rather than widening the interface keeps the rate a property of *this*
 * mixer, which is whose business it is.
 */
export class WebAudioMixer implements AudioMixer<AudioBuffer> {
    constructor(
        private readonly sampleRate: number = DEFAULT_SAMPLE_RATE,
        private readonly catalog?: AssetCatalog,
    ) { }

    mix(
        requests: readonly ScheduledAudioRequest[],
        totalDuration: number,
    ): Promise<AudioBuffer | null> {
        return mixAudio(requests, totalDuration, {
            sampleRate: this.sampleRate,
            catalog: this.catalog,
        });
    }
}

/**
 * Encode an `AudioBuffer` as a 16-bit PCM WAV.
 *
 * The only other encoder in this package is the AAC track inside the mp4 muxer,
 * which is reachable solely by exporting a video — so without this a mixdown has
 * no file representation at all. WAV because it needs no codec support and is
 * lossless; a host wanting mp3/aac can re-encode from here.
 */
export function encodeWav(buffer: AudioBuffer): Uint8Array<ArrayBuffer> {
    const channelCount = buffer.numberOfChannels;
    const frameCount = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channelCount * bytesPerSample;
    const dataBytes = frameCount * blockAlign;

    const out = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(out);

    const ascii = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };

    ascii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);            // PCM header length
    view.setUint16(20, 1, true);             // format: PCM
    view.setUint16(22, channelCount, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 8 * bytesPerSample, true);
    ascii(36, "data");
    view.setUint32(40, dataBytes, true);

    // Pull each channel out once — getChannelData is a live view, but calling it
    // per sample inside the interleave loop is measurably slower.
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) channels.push(buffer.getChannelData(c));

    let offset = 44;
    for (let frame = 0; frame < frameCount; frame++) {
        for (let c = 0; c < channelCount; c++) {
            // Clamp before scaling: the mix bus can exceed [-1,1] where clips
            // overlap, and letting that wrap turns a loud passage into noise.
            const sample = Math.max(-1, Math.min(1, channels[c][frame]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += bytesPerSample;
        }
    }

    return new Uint8Array(out);
}
