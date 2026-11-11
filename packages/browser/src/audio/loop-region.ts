import type { AudioRequest } from "@motionscript/core";

/** The span of a decoded buffer a looping request repeats, in source seconds. */
export interface LoopRegion {
    start: number;
    end: number;
}

/** The region a looping request repeats (in-point to out-point, else the end of the buffer); `null` when it does not loop or is degenerate (out-point at or before in-point), where the device wraps the whole buffer. Shared with the offline mixer so preview and export loop the same samples. */
export function loopRegionOf(request: AudioRequest, bufferDuration: number): LoopRegion | null {
    if (!request.loop) return null;
    const start = Math.min(Math.max(0, request.trimStart), bufferDuration);
    const end = Math.min(request.trimEnd ?? bufferDuration, bufferDuration);
    return end > start ? { start, end } : null;
}

/** Configures `source` to loop `request`'s trimmed region rather than the whole buffer (`loopStart`/`loopEnd` default to the whole buffer, which loses a trim). */
export function applyLoop(source: AudioBufferSourceNode, request: AudioRequest): LoopRegion | null {
    source.loop = request.loop;
    const region = source.buffer ? loopRegionOf(request, source.buffer.duration) : null;
    if (region) {
        source.loopStart = region.start;
        source.loopEnd = region.end;
    }
    return region;
}

/** Folds a source offset into a loop region: a seek into a looping clip lands at `trimStart + elapsed`, possibly many passes past the end, and the device does not wrap an offset that starts outside the region. */
export function wrapIntoRegion(region: LoopRegion | null, offset: number): number {
    if (!region || offset < region.end) return offset;
    return region.start + ((offset - region.start) % (region.end - region.start));
}
