import type { ExportRequest } from './page-bridge.js';

export type FrameRange = NonNullable<ExportRequest['frames']>;

/**
 * `totalFrames` as at most `concurrency` contiguous ranges in timeline order,
 * none more than a frame longer than another. Fewer frames than `concurrency`
 * get a range each.
 */
export function splitFrames(totalFrames: number, concurrency: number): FrameRange[] {
    const count = Math.max(1, Math.min(Math.floor(concurrency), totalFrames));
    const base = Math.floor(totalFrames / count);
    const longer = totalFrames % count;
    const ranges: FrameRange[] = [];
    let start = 0;
    for (let i = 0; i < count; i++) {
        const end = start + base + (i < longer ? 1 : 0);
        ranges.push({ start, end });
        start = end;
    }
    return ranges;
}
