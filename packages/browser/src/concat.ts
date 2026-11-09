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
 * Join encoded MP4 or WebM segments end to end, without re-encoding.
 *
 * The point of this is what it *doesn't* do: no decode, no encode, no pixels.
 * Each segment is demuxed to its encoded packets, the packets are re-stamped onto
 * one continuous timeline, and a single muxer writes them into one container. The
 * bytes of every frame survive untouched, so the result is bit-identical to the
 * segments and the whole thing runs at I/O speed rather than encode speed.
 *
 * It exists so an export can be **split across workers**. Rendering a timeline is
 * embarrassingly parallel per scene — each scene's generator is independent — but
 * the output has to be one file, and re-encoding the parts to join them would give
 * back everything the parallelism won (and lose a generation of quality). Joining
 * at the packet level is what makes splitting worth doing.
 *
 * ## What the caller has to guarantee
 *
 * **Every segment must be encoded with an identical configuration** — same
 * container, codec, resolution and bitrate settings. A container carries exactly one decoder
 * configuration for a track, so a segment whose parameter sets differ from the
 * first would be described by a configuration that isn't its own, and decode as
 * garbage from that point on. That is not a theoretical concern: hardware encoders
 * are free to pick different parameter sets for the same nominal settings. This is
 * checked rather than assumed — see {@link ConcatMismatchError} — because the
 * failure is silent corruption rather than an exception.
 *
 * **Every segment must begin with a key frame.** Otherwise its first packets refer
 * back to frames that lived in the previous segment's GOP and no longer precede
 * them. Encoders start with a key frame by default; a caller choosing an explicit
 * `keyFrameInterval` needs it to divide the segment length.
 *
 * Audio is *muxed* here but never *joined*: the segments' own audio is ignored
 * entirely, and a single already-mixed buffer is encoded once across the whole
 * result (see {@link ConcatOptions.audio}). Concatenating separately-encoded AAC
 * would put the encoder's priming delay at every join — a click at each boundary
 * and a track that drifts further out of sync with every one — so the timeline's
 * audio is mixed in one pass by whoever owns the timeline, and arrives here as
 * one buffer.
 */

/** Thrown when segments can't be joined losslessly. Carries which segment disagreed. */
export class ConcatMismatchError extends Error {
    constructor(
        /** Index of the offending segment in the input array. */
        readonly segment: number,
        message: string,
    ) {
        super(message);
        this.name = "ConcatMismatchError";
    }
}

/** One segment's demuxed video track, plus the config that describes it. */
interface Segment {
    format: VideoFormat;
    track: InputVideoTrack;
    config: VideoDecoderConfig;
    duration: number;
}

/**
 * Two decoder configurations describe the same bitstream.
 *
 * `description` holds the codec's parameter sets (the `avcC` box for H.264) and is
 * the field that actually decides decodability — a differing one is exactly the
 * silent-corruption case. Compared bytewise; the rest are compared by value.
 */
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
    /**
     * One continuous audio track for the whole joined timeline.
     *
     * Mixed once by the caller (see `mixTimelineAudio`) rather than per segment,
     * and that is not a convenience: separately-encoded AAC carries an encoder
     * priming delay at the head of each piece, so joining them puts a click at
     * every scene boundary and drifts the track further out of sync with each
     * one. One buffer in, one encode, no seams.
     */
    audio?: AudioBuffer | null;
    /** Bitrate for that track: AAC in an MP4, Opus in a WebM. Defaults to 192 kbps. */
    audioBitrate?: number;
    /**
     * Write the result out as it is muxed instead of returning it.
     *
     * With this the joined file never exists in memory as one buffer, which is
     * the difference between an export the process can hold and one it can't:
     * a 4× 60fps render is hundreds of megabytes, and the default path costs
     * roughly twice that at the tail once the `Blob` copy is counted.
     *
     * **Chunks carry a byte `position` and do not arrive in file order** — a
     * muxer seeks back to patch atom sizes. A sink that appends will produce a
     * file of exactly the right length whose size fields belong to a different
     * one: unplayable, and indistinguishable from success until it is opened.
     * Honour `position`.
     *
     * `concatVideoSegments` resolves to an empty array when this is used; the
     * bytes went to the sink.
     */
    stream?: WritableStream<{ type: "write"; data: Uint8Array; position: number }>;
}

/** Joins segments one at a time, in timeline order, as each becomes available. */
export interface SegmentJoiner {
    /**
     * Mux the next segment after the ones already appended. Appends must not
     * overlap: await each before starting the next.
     *
     * @throws {ConcatMismatchError} as {@link concatVideoSegments} does.
     */
    append(segment: Uint8Array): Promise<void>;
    /** Finish the container. The bytes, or an empty array when they went to `stream`. */
    finish(): Promise<Uint8Array>;
    /** Abandon the join; nothing more is written. */
    cancel(): Promise<void>;
}

/**
 * {@link concatVideoSegments} one segment at a time, so a split export can write
 * each piece the moment it and every piece before it exist, instead of holding
 * every segment until the last one lands.
 *
 * The audio, when given, is encoded as soon as the first segment fixes the
 * container, ahead of the video: the muxer holds the (small) audio packets and
 * interleaves them as the video catches up.
 */
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
        // `codec` comes off the track rather than the decoder config: the latter's
        // `codec` is the full codec *string* (`avc1.64001f`), while the source wants
        // the family.
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
                // The decoder config is handed over with each segment's first packet.
                // Only the first can take effect (a container holds one per track), but
                // every one has been checked equal to it.
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
 * Concatenate `segments` (each a complete MP4, or each a complete WebM) into one
 * file of the same container.
 *
 * Segments are joined in array order. Returns the muxed bytes.
 *
 * @throws {ConcatMismatchError} if a segment carries no video track, is in another
 *         container than the first, or has a decoder configuration that differs
 *         from the first segment's. Callers that can
 *         fall back to a single-threaded export should catch this and do so — the
 *         alternative is shipping a file that decodes into garbage halfway through.
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
