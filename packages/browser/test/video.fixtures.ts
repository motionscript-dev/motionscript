import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, type VideoCodec } from "mediabunny";

/**
 * A clip made in the page: frame `i` is a solid `colours[i]`, so the colour at a
 * time says which frame sounded there. VP9 by default, which every Chromium
 * encodes, so a suite using it needs no H.264 encoder (see `encoders.fixtures.ts`).
 */
export async function encodeClip(
    colours: readonly string[],
    options: { fps?: number; size?: number; codec?: VideoCodec } = {},
): Promise<Blob> {
    const fps = options.fps ?? 10;
    const size = options.size ?? 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new CanvasSource(canvas, { codec: options.codec ?? "vp9", bitrate: 4_000_000, keyFrameInterval: 0.2 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    for (const [i, colour] of colours.entries()) {
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, size, size);
        await source.add(i / fps, 1 / fps);
    }
    source.close();
    await output.finalize();
    return new Blob([target.buffer!], { type: "video/mp4" });
}
