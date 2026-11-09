import { describe, expect, it } from 'vitest';
import { splitFrames } from '../segments.js';

describe('splitFrames', () => {
    it('cuts the timeline into contiguous ranges that cover it once, in order', () => {
        expect(splitFrames(90, 8)).toEqual([
            { start: 0, end: 12 }, { start: 12, end: 24 }, { start: 24, end: 35 }, { start: 35, end: 46 },
            { start: 46, end: 57 }, { start: 57, end: 68 }, { start: 68, end: 79 }, { start: 79, end: 90 },
        ]);
    });

    it('gives the frames that do not divide evenly to the first ranges, one each', () => {
        const lengths = splitFrames(10, 3).map(({ start, end }) => end - start);
        expect(lengths).toEqual([4, 3, 3]);
    });

    it('makes one range per frame when there are fewer frames than pages', () => {
        expect(splitFrames(3, 8)).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }]);
    });

    it('keeps one range for a concurrency of 1, or below it', () => {
        expect(splitFrames(30, 1)).toEqual([{ start: 0, end: 30 }]);
        expect(splitFrames(30, 0)).toEqual([{ start: 0, end: 30 }]);
        expect(splitFrames(30, 2.7)).toEqual([{ start: 0, end: 15 }, { start: 15, end: 30 }]);
    });

    it('leaves an empty timeline as one empty range, which nothing splits', () => {
        expect(splitFrames(0, 4)).toEqual([{ start: 0, end: 0 }]);
    });
});
