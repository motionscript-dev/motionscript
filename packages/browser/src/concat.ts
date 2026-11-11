import {
    BufferSource,
    BufferTarget,
    EncodedPacketSink,
    EncodedVideoPacketSource,
    Input,
    MP4,
    Output,
    StreamTarget,
    WEBM,
    type InputVideoTrack,
    type VideoCodec,
} from "mediabunny";

import { audioTrackSource, formatSpec, type VideoFormat } from "./formats";

/**
 * Joins encoded MP4 or WebM segments end to end without re-encoding: segments are demuxed to packets, re-stamped onto
 * one timeline and muxed into one container, so frame bytes survive untouched and it runs at I/O speed. It exists so an
 * export can be **split across workers** without re-encoding the parts (which would lose a generation of quality).
 *
 * The caller must guarantee: **every segment is encoded with an identical configuration** (container, codec,
 * resolution, bitrate settings), since a container carries one decoder configuration per track and a differing one
 * decodes as garbage from that point (hardware encoders may pick different parameter sets for the same settings; this
 * is checked, see {@link ConcatMismatchError}, because the failure is silent). And **every segment begins with a key
 * frame**; a caller choosing an explicit `keyFrameInterval` needs it to divide the segment length.
 *
 * Audio is *muxed* here but never *joined*: the segments' own audio is ignored and one already-mixed buffer is encoded
 * across the whole result (see {@link ConcatOptions.audio}), because separately-encoded AAC puts the encoder's priming
 * delay at every join.
 */

/** Thrown when segments can't be joined losslessly. Carries which segment disagreed. */
export class ConcatMismatchError extends Error {
    constructor(
        readonly segment: number,
        message: string,
    ) {
        super(message);
        this.name = "ConcatMismatchError";
    }
}

interface Segment {
    format: VideoFormat;
    track: InputVideoTrack;
    config: VideoDecoderConfig;
    duration: number;
}

/** Two decoder configurations describe the same bitstream. `description` (parameter sets, the `avcC` box for H.264) decides decodability and is compared bytewise; the rest by value. */
function sameDecoderConfig(a: VideoDecoderConfig, b: VideoDecoderConfig): boolean {
    if (a.codec !== b.codec) return false;
    if (a.codedWidth !== b.codedWidth) return false;
    if (a.codedHeight !== b.codedHeight) return false;

    const da = toBytes(a.description);
    const db = toBytes(b.description);
    if (da === null || db === null) return da === db;
    if (da.length !== db.length) return false;
    for (let i = 0; i < da.length; i++) {
        if (da[i] !== db[i]) return false;
    }
    return true;
}

function toBytes(description: VideoDecoderConfig["description"]): Uint8Array | null {
    if (!description) return null;
    // `description` is a BufferSource: an ArrayBuffer, a SharedArrayBuffer, or any
    // view over one. Views carry an offset into a larger buffer, so they must be
    // narrowed rather than wrapped whole.
    if (ArrayBuffer.isView(description)) {
        return new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
    }
    return new Uint8Array(description);
}

export interface ConcatOptions {
    /** One continuous audio track, mixed once by the caller (see `mixTimelineAudio`): separately-encoded AAC carries a priming delay per piece, so joining them clicks at every boundary and drifts out of sync. */
    audio?: AudioBuffer | null;
    /** Bitrate for that track: AAC in an MP4, Opus in a WebM. Defaults to 192 kbps. */
    audioBitrate?: number;
    /**
     * Write the result out as it is muxed instead of returning it, so the joined file never exists in memory as one
     * buffer (a 4x 60fps render is hundreds of megabytes, twice that at the tail once the `Blob` copy is counted).
     *
     * **Chunks carry a byte `position` and do not arrive in file order** (a muxer seeks back to patch atom sizes). A sink
     * that appends produces a file of the right length that is unplayable, indistinguishable from success until opened.
     * Honour `position`. `concatVideoSegments` resolves to an empty array when this is used.
     */
    stream?: WritableStream<{ type: "write"; data: Uint8Array; position: number }>;
}

/** Joins segments one at a time, in timeline order, as each becomes available. */
export interface SegmentJoiner {
    /**
     * Appends must not overlap: await each before starting the next.
     *
     * @throws {ConcatMismatchError} as {@link concatVideoSegments} does.
     */
    append(segment: Uint8Array): Promise<void>;
    /** Finish the container. The bytes, or an empty array when they went to `stream`. */
    finish(): Promise<Uint8Array>;
    /** Abandon the join; nothing more is written. */
    cancel(): Promise<void>;
}

/** {@link concatVideoSegments} one segment at a time, so a split export writes each piece as soon as it and every piece before it exist. Audio is encoded as soon as the first segment fixes the container, ahead of the video; the muxer interleaves it as the video catches up. */
export function createSegmentJoiner(options: ConcatOptions = {}): SegmentJoiner {
    let first: Segment | null = null;
    let output: Output | null = null;
    let source: EncodedVideoPacketSource | null = null;
    let audioSource: ReturnType<typeof audioTrackSource> | null = null;
    let target: StreamTarget | BufferTarget | null = null;
    let index = 0;
    let offset = 0;

    const start = async (segment: Segment) => {
        target = options.stream
            ? new StreamTarget(options.stream as ConstructorParameters<typeof StreamTarget>[0])
            : new BufferTarget();
        output = new Output({ format: formatSpec(segment.format).container(), target });
        // `codec` comes off the track: the decoder config's is the full codec *string* (`avc1.64001f`), the source wants the family.
        source = new EncodedVideoPacketSource(segment.track.codec as VideoCodec);
        output.addVideoTrack(source);
        // Declared before `start()`: a muxer fixes its track list up front.
        audioSource = options.audio ? audioTrackSource(segment.format, options.audioBitrate) : null;
        if (audioSource) output.addAudioTrack(audioSource);
        await output.start();
        if (audioSource && options.audio) await audioSource.add(options.audio);
    };

    return {
        async append(bytes) {
            const i = index++;
            const input = new Input({ source: new BufferSource(bytes), formats: [MP4, WEBM] });
            try {
                const segment = await openSegment(input, i, first);
                if (!first) {
                    first = segment;
                    await start(segment);
                }
                // The decoder config rides each segment's first packet; only the first can take effect (one per track), but all were checked equal.
                let leading = true;
                for await (const packet of new EncodedPacketSink(segment.track).packets()) {
                    await source!.add(
                        packet.clone({ timestamp: packet.timestamp + offset }),
                        leading ? { decoderConfig: segment.config } : undefined,
                    );
                    leading = false;
                }
                // The segment's own duration rather than its last packet's end: summing
                // packet durations accumulates rounding into a drift across many segments.
                offset += segment.duration;
            } finally {
                input.dispose();
            }
        },
        async finish() {
            if (!output) throw new Error("concatVideoSegments: no segments");
            source!.close();
            audioSource?.close();
            await output.finalize();
            if (options.stream) return new Uint8Array(0);
            const buffer = (target as BufferTarget).buffer;
            if (!buffer) throw new Error("concatVideoSegments produced no data");
            return new Uint8Array(buffer);
        },
        async cancel() {
            if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel();
        },
    };
}

/** Demux one segment and check it can follow `first`. */
async function openSegment(input: Input, i: number, first: Segment | null): Promise<Segment> {
    const format: VideoFormat = (await input.getFormat()) === WEBM ? "webm" : "mp4";
    if (first && format !== first.format) {
        throw new ConcatMismatchError(i, `Segment ${i} is ${format} and segment 0 is ${first.format}.`);
    }
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new ConcatMismatchError(i, `Segment ${i} has no video track.`);
    const config = await track.getDecoderConfig();
    if (!config) throw new ConcatMismatchError(i, `Segment ${i} has no decoder configuration.`);
    if (first && !sameDecoderConfig(first.config, config)) {
        throw new ConcatMismatchError(
            i,
            `Segment ${i} was encoded differently from segment 0 (${first.config.codec} `
            + `${first.config.codedWidth}x${first.config.codedHeight} vs ${config.codec} `
            + `${config.codedWidth}x${config.codedHeight}); joining them would decode as garbage.`,
        );
    }
    return { format, track, config, duration: await track.computeDuration() };
}

/**
 * Concatenates `segments` (all MP4 or all WebM) in array order into one file of the same container.
 *
 * @throws {ConcatMismatchError} if a segment has no video track, is in another container than the first, or has a
 *         differing decoder configuration. Callers that can fall back to a single-threaded export should catch this.
 */
export async function concatVideoSegments(
    segments: Uint8Array[],
    options: ConcatOptions = {},
): Promise<Uint8Array> {
    if (segments.length === 0) throw new Error("concatVideoSegments: no segments");
    // A lone segment is already the finished file — unless a track has to be added
    // to it, or it has to go to a sink, either of which means muxing after all.
    if (segments.length === 1 && !options.audio && !options.stream) return segments[0];

    const joiner = createSegmentJoiner(options);
    try {
        for (const segment of segments) await joiner.append(segment);
        return await joiner.finish();
    } catch (error) {
        await joiner.cancel().catch(() => {});
        throw error;
    }
}
