import { describe, it, expect, vi } from 'vitest';
import {
    declareFilter, lerpFilter, lerpFilterArray, lerpOptionalFilters, isPixelFilter, hasFilter, filterSurface,
} from '@/attributes/shape/filters/registry';
import { Adjustments, VideoAdjustments } from '@/attributes/shape/filters/chain';
import type { AssetScope } from '@/assets/scope';
import { MediaAdjustment, VideoOnlyAdjustment } from '@/attributes/shape/filters/union';
import { blurFilter } from '@/attributes/shape/filters/implementations/blur';
import { curvesFilter } from '@/attributes/shape/filters/implementations/curves';

type AnyFilter = MediaAdjustment | VideoOnlyAdjustment;

describe('FILTERS map', () => {
    it('contains every built-in filter, including the new video-only ones', () => {
        for (const type of ['blur', 'alpha', 'grayscale', 'curves', 'posterizeTime', 'echo']) {
            expect(hasFilter(type)).toBe(true);
        }
        expect(hasFilter('does-not-exist')).toBe(false);
    });

    it('classifies pixel vs video-only filters', () => {
        expect(isPixelFilter('blur')).toBe(true);
        expect(isPixelFilter('colorAdjustment')).toBe(true);
        expect(isPixelFilter('posterizeTime')).toBe(false);
        expect(isPixelFilter('echo')).toBe(false);
    });

    it('recognises the node effects that double as filters', () => {
        for (const type of ['oilPaint', 'dither', 'halftone', 'scanlines', 'sharpen', 'invert']) {
            expect(hasFilter(type)).toBe(true);
            expect(isPixelFilter(type)).toBe(true);
        }
    });
});

describe('filterSurface', () => {
    it('reports a colour transform as composable', () => {
        expect(filterSurface({ type: 'blur', radius: 4 })).toBe('filter');
        expect(filterSurface({ type: 'invert', channel: 'rgba', strength: 1 })).toBe('filter');
    });

    it('reports a position resampler as needing a shader', () => {
        expect(filterSurface({ type: 'oilPaint', radius: 3 })).toBe('shader');
        expect(filterSurface({ type: 'dither', levels: 4, matrix: 4, scale: 2, monochrome: false, noise: 'bayer' }))
            .toBe('shader');
    });

    it('ignores a stray `mode` — a fill has no backdrop', () => {
        // `shader` is the one effect whose surface depends on its own fields.
        expect(filterSurface({ type: 'shader', source: '', mode: 'backdrop' } as never)).toBe('filter');
    });
});

describe('lerpFilter', () => {
    it('interpolates two filters of the same type (no longer hard-cuts — the populated-map fix)', () => {
        const result = lerpFilter(
            { type: 'blur', radius: 0 },
            { type: 'blur', radius: 10 },
            0.5,
        ) as Extract<MediaAdjustment, { type: 'blur' }>;
        expect(result.radius).toBe(5);
    });

    it('interpolates the new posterizeTime fps', () => {
        const result = lerpFilter(
            { type: 'posterizeTime', fps: 4 },
            { type: 'posterizeTime', fps: 12 },
            0.5,
        ) as Extract<VideoOnlyAdjustment, { type: 'posterizeTime' }>;
        expect(result.fps).toBe(8);
    });

    it('interpolates echo fields and hard-cuts the discrete blend', () => {
        const result = lerpFilter(
            { type: 'echo', echoes: 2, delay: 0.1, decay: 0.4, blend: 'screen' },
            { type: 'echo', echoes: 6, delay: 0.3, decay: 0.8, blend: 'lighten' },
            0.5,
        ) as Extract<VideoOnlyAdjustment, { type: 'echo' }>;
        expect(result.echoes).toBe(4);
        expect(result.delay).toBeCloseTo(0.2, 6);
        expect(result.decay).toBeCloseTo(0.6, 6);
        expect(result.blend).toBe('lighten');
    });

    it('hard-cuts at t=0.5 when the two filter types differ', () => {
        const from: AnyFilter = { type: 'blur', radius: 1 };
        const to: AnyFilter = { type: 'alpha', amount: 1 };
        expect(lerpFilter(from, to, 0.4)).toBe(from);
        expect(lerpFilter(from, to, 0.6)).toBe(to);
    });

    it('hands an effect-backed filter to the effects registry', () => {
        const result = lerpFilter(
            { type: 'oilPaint', radius: 0 },
            { type: 'oilPaint', radius: 6 },
            0.5,
        ) as Extract<MediaAdjustment, { type: 'oilPaint' }>;
        expect(result.radius).toBe(3);
    });
});

describe('lerpOptionalFilters', () => {
    it('answers undefined when neither side has a filter', () => {
        expect(lerpOptionalFilters(undefined, undefined, 0.5)).toBeUndefined();
        expect(lerpOptionalFilters([], undefined, 0.5)).toBeUndefined();
    });

    it('interpolates when either side has one', () => {
        expect(lerpOptionalFilters<AnyFilter>(
            [{ type: 'grayscale', amount: 0 }],
            [{ type: 'grayscale', amount: 1 }],
            0.25,
        )).toEqual([{ type: 'grayscale', amount: 0.25 }]);
    });
});

describe('lerpFilterArray', () => {
    it('lerps matched indices pairwise', () => {
        const from: AnyFilter[] = [{ type: 'blur', radius: 0 }];
        const to: AnyFilter[] = [{ type: 'blur', radius: 8 }];
        expect(lerpFilterArray(from, to, 0.5)).toEqual([{ type: 'blur', radius: 4 }]);
    });

    it('keeps extra source entries when the target is shorter', () => {
        const from: AnyFilter[] = [{ type: 'blur', radius: 2 }, { type: 'alpha', amount: 1 }];
        const to: AnyFilter[] = [{ type: 'blur', radius: 2 }];
        const out = lerpFilterArray(from, to, 0.5);
        expect(out).toHaveLength(2);
        expect(out[1]).toEqual({ type: 'alpha', amount: 1 });
    });

    it('keeps extra target entries when the source is shorter', () => {
        const from: AnyFilter[] = [{ type: 'blur', radius: 2 }];
        const to: AnyFilter[] = [{ type: 'blur', radius: 2 }, { type: 'alpha', amount: 0.5 }];
        const out = lerpFilterArray(from, to, 0.5);
        expect(out).toHaveLength(2);
        expect(out[1]).toEqual({ type: 'alpha', amount: 0.5 });
    });
});

describe('filter data constants – lerp & equals', () => {
    it('blur lerps and compares by radius', () => {
        expect(blurFilter.lerp({ type: 'blur', radius: 0 }, { type: 'blur', radius: 4 }, 0.25))
            .toEqual({ type: 'blur', radius: 1 });
        expect(blurFilter.equals({ type: 'blur', radius: 3 }, { type: 'blur', radius: 3 })).toBe(true);
        expect(blurFilter.equals({ type: 'blur', radius: 3 }, { type: 'blur', radius: 4 })).toBe(false);
    });

    it('curves lerps points and hard-cuts the channel at t=0.5', () => {
        const from = { type: 'curves', channel: 'r', points: [[0, 0], [1, 1]] } as const;
        const to = { type: 'curves', channel: 'g', points: [[0, 0.5], [1, 0.5]] } as const;
        const early = curvesFilter.lerp(from as any, to as any, 0.25) as any;
        const late = curvesFilter.lerp(from as any, to as any, 0.75) as any;
        expect(early.channel).toBe('r');
        expect(late.channel).toBe('g');
        expect(early.points[0][1]).toBeCloseTo(0.125, 6);
    });
});

describe('declareFilter', () => {
    const scope = () => ({ image: vi.fn(), video: vi.fn(), loader: vi.fn(), font: vi.fn() });
    const declare = (filter: AnyFilter) => {
        const assets = scope();
        declareFilter(filter, assets as unknown as AssetScope);
        return assets;
    };

    it('declares nothing for a dedicated filter', () => {
        for (const filter of [
            { type: 'blur', radius: 4 }, { type: 'alpha', amount: 0.5 }, { type: 'grayscale', amount: 1 },
        ] as AnyFilter[]) {
            const assets = declare(filter);
            for (const call of Object.values(assets)) expect(call).not.toHaveBeenCalled();
        }
    });

    it('declares nothing for the video-only filters, which are dedicated too', () => {
        const [posterize] = [...VideoAdjustments.posterizeTime(12)];
        const [echo] = [...VideoAdjustments.echo({ echoes: 3, delay: 0.1 })];
        for (const filter of [posterize, echo]) {
            const assets = declare(filter);
            for (const call of Object.values(assets)) expect(call).not.toHaveBeenCalled();
        }
    });

    it('declares nothing for an effect-backed filter that loads nothing', () => {
        const [oilPaint] = [...Adjustments.oilPaint(3)];
        const assets = declare(oilPaint);
        for (const call of Object.values(assets)) expect(call).not.toHaveBeenCalled();
    });

    it('declares nothing for a type no one registered', () => {
        const assets = declare({ type: 'plasma' } as unknown as AnyFilter);
        for (const call of Object.values(assets)) expect(call).not.toHaveBeenCalled();
    });
});

describe('hasFilter', () => {
    it('is true for a dedicated filter and for a registered effect', () => {
        expect(hasFilter('exposure')).toBe(true);
        expect(hasFilter('colorMatrix')).toBe(true);
        expect(hasFilter('kaleidoscope')).toBe(true);
    });

    it('is false for a type that is neither', () => {
        expect(hasFilter('plasma')).toBe(false);
        expect(hasFilter('')).toBe(false);
    });

    it('does not mistake an object property of the table for a filter', () => {
        expect(hasFilter('constructor')).toBe(false);
        expect(hasFilter('toString')).toBe(false);
    });
});

describe('lerpOptionalFilters – one-sided and matching', () => {
    it('takes the filters of a side that has them when the other has none, unchanged and un-faded', () => {
        const only: AnyFilter[] = [{ type: 'blur', radius: 8 }];
        expect(lerpOptionalFilters(undefined, only, 0.25)).toEqual(only);
        expect(lerpOptionalFilters(only, undefined, 0.75)).toEqual(only);
        expect(lerpOptionalFilters([], only, 0.5)).toEqual(only);
    });

    it('answers a new array rather than the one it was given', () => {
        const only: AnyFilter[] = [{ type: 'blur', radius: 8 }];
        expect(lerpOptionalFilters(undefined, only, 0.5)).not.toBe(only);
    });

    it('lerps matched indices and keeps the rest, in one pass', () => {
        const from: AnyFilter[] = [{ type: 'blur', radius: 0 }];
        const to: AnyFilter[] = [{ type: 'blur', radius: 10 }, { type: 'alpha', amount: 0.3 }];
        expect(lerpOptionalFilters(from, to, 0.5)).toEqual([{ type: 'blur', radius: 5 }, { type: 'alpha', amount: 0.3 }]);
    });

    it('switches two different types at t = 0.5', () => {
        const from: AnyFilter[] = [{ type: 'blur', radius: 4 }];
        const to: AnyFilter[] = [{ type: 'grayscale', amount: 1 }];
        expect(lerpOptionalFilters(from, to, 0.49)).toEqual(from);
        expect(lerpOptionalFilters(from, to, 0.5)).toEqual(to);
    });
});
