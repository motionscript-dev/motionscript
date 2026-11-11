import type { AssetManifest, ProjectDocument, Registry, Size2D, VisualDocument } from "@motionscript/core";
import { BufferTarget, Output } from "mediabunny";

import { deliver } from "./deliver";
import type { RendererWasmOption } from "./renderer";
import type { AudioEncoderOptions, ExportProgressCallback } from "./exporter";
import { audioTrackSource, ensureAudioEncoder, formatSpec, type AudioFormat } from "./formats";
import { mixTimelineAudio } from "./mix-timeline-audio";

export type ExportAudioParams = RendererWasmOption & {
    /** A project, or a lone still or composition as the one track of one. */
    document: ProjectDocument | VisualDocument;
    /** The vocabulary its clips compile against. Defaults to what the library ships. */
    registry?: Registry;
    /** Discovery lays clips out at this size and rate; 1920×1080 at 60 fps when neither the document nor this says. */
    viewport?: Size2D;
    fps?: number;
    manifest?: AssetManifest;
    /** Defaults to `'wav'`, which needs no encoder. */
    format?: AudioFormat;
    audio?: AudioEncoderOptions;
    /** Defaults to `export.<extension>`. */
    filename?: string;
    onProgress?: ExportProgressCallback;
    signal?: AbortSignal;
    /** When true, the encoded bytes are returned instead of triggering a browser download. */
    returnBytes?: boolean;
};

/** The timeline schedules no sound, so an audio-only export has nothing to write. */
export class NoAudioError extends Error {
    override readonly name = "NoAudioError";

    constructor() {
        super("The timeline has no audio to export.");
    }
}

/** Mixes the timeline's audio and encodes it alone (WAV, MP3 or M4A/AAC); nothing is drawn, so no frame is rendered and no GPU surface made. @throws {NoAudioError} when nothing plays, rather than writing a silent file. */
export async function exportAudio(params: ExportAudioParams): Promise<Uint8Array | void> {
    const { format = "wav", audio = {}, onProgress, signal, returnBytes = false } = params;
    const spec = formatSpec(format);
    if (spec.kind !== "audio") throw new RangeError(`exportAudio writes audio; "${format}" is video, which exportVideo writes.`);
    signal?.throwIfAborted();
    // Before the mix, so a browser that cannot encode the format fails fast.
    await ensureAudioEncoder(format);

    const mixed = await mixTimelineAudio({
        document: params.document,
        registry: params.registry,
        viewport: params.viewport,
        fps: params.fps,
        manifest: params.manifest,
        sampleRate: audio.sampleRate,
        rendererWasmUrl: params.rendererWasmUrl,
    });
    if (mixed === null) throw new NoAudioError();
    signal?.throwIfAborted();
    onProgress?.(0.5);

    const target = new BufferTarget();
    const output = new Output({ format: spec.container(), target });
    const source = audioTrackSource(format, audio.bitrate);
    output.addAudioTrack(source);
    await output.start();
    await source.add(mixed);
    source.close();
    await output.finalize();
    if (!target.buffer) throw new Error("Export produced no data");
    onProgress?.(1);

    return deliver(new Uint8Array(target.buffer), {
        returnBytes,
        filename: params.filename ?? `export.${spec.extension}`,
        mimeType: spec.mimeType,
    });
}
