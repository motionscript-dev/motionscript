import type { AudioRequest } from "@motionscript/core";

/** The span of a decoded buffer a looping request repeats, in source seconds. */
export interface LoopRegion {
    start: number;
    end: number;
}

/**
 * The region a looping request repeats: from its in-point to its out-point, or to
 * the end of the buffer when it has none. `null` for a request that does not loop,
 * and for a degenerate region (an out-point at or before the in-point), where the
 * device falls back to wrapping the whole buffer.
 *
 * Shared by the live device and the offline mixer so a preview and an export loop
 * the same samples.
 */
export function loopRegionOf(request: AudioRequest, bufferDuration: number): LoopRegion | null {
    if (!request.loop) return null;
    const start = Math.min(Math.max(0, request.trimStart), bufferDuration);
    const end = Math.min(request.trimEnd ?? bufferDuration, bufferDuration);
    return end > start ? { start, end } : null;
}

/**
 * Configure `source` to play `request`'s loop: on or off, and over the trimmed
 * region rather than the whole buffer (`loopStart`/`loopEnd` default to the
 * whole buffer, which is how a trim used to be lost).
 */
export function applyLoop(source: AudioBufferSourceNode, request: AudioRequest): LoopRegion | null {
    source.loop = request.loop;
    const region = source.buffer ? loopRegionOf(request, source.buffer.duration) : null;
    if (region) {
        source.loopStart = region.start;
        source.loopEnd = region.end;
    }
    return region;
}

/**
 * Fold a source offset into a loop region.
 *
 * A seek into the middle of a looping clip lands at `trimStart + elapsed`, which
 * can be many passes past the region's end; the device would not wrap an offset
 * that starts outside the region, so it is wrapped here.
 */
export function wrapIntoRegion(region: LoopRegion | null, offset: number): number {
    if (!region || offset < region.end) return offset;
    return region.start + ((offset - region.start) % (region.end - region.start));
}
