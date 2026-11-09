import { BufferSource, EncodedPacketSink, Input, MP4, VideoSampleSink } from "mediabunny";
import type { AssetManifest, ProjectDocument } from "@motionscript/core";
import { node, project, still, track } from "./document.fixtures";
import { encodeWav } from "../src/audio/mixer";
import { exportVideo, type ExportParams } from "../src/exporter";
import { toneBuffer } from "./audio.fixtures";

/**
 * Helpers for the suites that encode a real MP4 with `exportVideo` and read the
 * container back. VP9 stands in for the default H.264, which not every Chromium
 * encodes (see `encoders.fixtures.ts`); a case about the default asks for AVC.
 */

export const VIEWPORT = { width: 64, height: 64 };
export const FPS = 10;

/** A solid fill over the whole frame. */
export const fullBleed = (fill: string) => still(node("r", "rect", { width: "fill", height: "fill", fill }));

/** `frames` frames of one solid colour. */
export const solidProject = (fill: string, frames = 2, over: Partial<ProjectDocument> = {}): ProjectDocument =>
    project([track("t", fullBleed(fill), { duration: frames / FPS })], { fps: FPS, viewport: VIEWPORT, ...over });

export function render(params: Omit<ExportParams, "returnBytes">): Promise<Uint8Array> {
    return exportVideo({
        supersample: 1,
        video: { codec: "vp9" },
        ...params,
        returnBytes: true,
    }) as Promise<Uint8Array>;
}

export interface Inspected {
    video: { codec: string | null; width: number; height: number; duration: number; frames: number; keyFrames: number; frameRate: number };
    audio: { codec: string | null; sampleRate: number; channels: number; duration: number; bitrate: number } | null;
    tracks: number;
}

/** What the container holds, read back with the same library that wrote it. */
export async function inspect(bytes: Uint8Array): Promise<Inspected> {
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("no video track");
    let keyFrames = 0;
    for await (const packet of new EncodedPacketSink(video).packets()) if (packet.type === "key") keyFrames++;
    const stats = await video.computePacketStats();
    const audio = await input.getPrimaryAudioTrack();
    return {
        video: {
            codec: await video.getCodec(),
            width: await video.getDisplayWidth(),
            height: await video.getDisplayHeight(),
            duration: await video.computeDuration(),
            frames: stats.packetCount,
            keyFrames,
            frameRate: stats.averagePacketRate,
        },
        audio: audio
            ? {
                codec: await audio.getCodec(),
                sampleRate: await audio.getSampleRate(),
                channels: await audio.getNumberOfChannels(),
                duration: await audio.computeDuration(),
                bitrate: (await audio.computePacketStats()).averageBitrate,
            }
            : null,
        tracks: (await input.getTracks()).length,
    };
}

/** Every decoded frame's centre pixel, as `[r, g, b]`. */
export async function centres(bytes: Uint8Array, size = VIEWPORT): Promise<number[][]> {
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("no video track");
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const out: number[][] = [];
    for await (const sample of new VideoSampleSink(video).samples()) {
        sample.draw(ctx, 0, 0, size.width, size.height);
        out.push([...ctx.getImageData(size.width / 2, size.height / 2, 1, 1).data.slice(0, 3)]);
        sample.close();
    }
    return out;
}

/** A WAV of a constant tone as a blob URL, and the manifest that describes it. */
export function toneSource(seconds: number, amplitude: number): { src: string; manifest: AssetManifest } {
    const src = URL.createObjectURL(new Blob([encodeWav(toneBuffer(seconds, amplitude, 2))], { type: "audio/wav" }));
    return { src, manifest: { image: {}, video: {}, font: {}, audio: { [src]: { src, duration: seconds, sizeBytes: 0 } } } };
}

/**
 * A project of one solid-colour video track and one audio track playing `src`
 * from `startAt`, `seconds` long.
 */
export function withSound(src: string, over: { fill?: string; seconds?: number; startAt?: number } = {}): ProjectDocument {
    const seconds = over.seconds ?? 1;
    const sound = { kind: "audio" as const, nodes: [node("s", "sound", { src })], commands: [] };
    return project([
        track("v", fullBleed(over.fill ?? "#ff0000"), { duration: seconds }),
        track("a", sound as never, { startAt: over.startAt ?? 0, duration: seconds - (over.startAt ?? 0) }),
    ], { fps: FPS, viewport: VIEWPORT });
}
