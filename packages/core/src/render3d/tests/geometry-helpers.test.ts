import { describe, expect, it } from 'vitest';
import { segmentsOf } from '@/render3d/segments';
import { cylinderRadii, resolveBevel3D } from '@/render3d/geometry';
import {
    resolveShadowOptions3D, shadowCasts, shadowReceives,
    type Shadow3D,
} from '@/render3d/transform';

describe('segmentsOf', () => {
    it('is entirely the defaults when unset, so no shape is pinned to a resolution invented at a call site', () => {
        expect(segmentsOf(undefined, [32, 16])).toEqual([32, 16]);
        expect(segmentsOf(undefined, [1, 1, 1])).toEqual([1, 1, 1]);
    });

    it('broadcasts a scalar to every axis the shape has', () => {
        expect(segmentsOf(8, [32, 16])).toEqual([8, 8]);
        expect(segmentsOf(4, [1, 1, 1])).toEqual([4, 4, 4]);
        expect(segmentsOf(4, [10])).toEqual([4]);
    });

    it('fills a short tuple from the defaults and leaves the rest at them', () => {
        expect(segmentsOf([6], [32, 16])).toEqual([6, 16]);
        expect(segmentsOf([6, 7], [32, 16, 5])).toEqual([6, 7, 5]);
        expect(segmentsOf([2, 3, 4], [1, 1, 1])).toEqual([2, 3, 4]);
    });

    it('ignores tuple entries beyond the number of axes the shape has', () => {
        expect(segmentsOf([2, 3, 4], [9, 9])).toEqual([2, 3]);
    });

    it('floors fractions and clamps every count to at least 1', () => {
        expect(segmentsOf(3.9, [32, 16])).toEqual([3, 3]);
        expect(segmentsOf(0, [32, 16])).toEqual([1, 1]);
        expect(segmentsOf(-5, [32, 16])).toEqual([1, 1]);
        expect(segmentsOf([0.4, 7.7], [32, 16])).toEqual([1, 7]);
    });

    it('applies the same floor and clamp to the defaults themselves', () => {
        expect(segmentsOf(undefined, [0, 2.5])).toEqual([1, 2]);
    });
});

describe('cylinderRadii', () => {
    it('is [1, 1] when unset', () => {
        expect(cylinderRadii(undefined)).toEqual([1, 1]);
    });

    it('applies a scalar to both ends', () => {
        expect(cylinderRadii(2)).toEqual([2, 2]);
        expect(cylinderRadii(0)).toEqual([0, 0]);
    });

    it('reads a pair as [top, bottom]', () => {
        expect(cylinderRadii([0.5, 2])).toEqual([0.5, 2]);
        expect(cylinderRadii([0, 3])).toEqual([0, 3]);
    });
});

describe('resolveBevel3D', () => {
    it('is null for undefined, so there is no bevel to build', () => {
        expect(resolveBevel3D(undefined)).toBeNull();
    });

    it('reads a number as the bevel size and scales the thickness off it', () => {
        expect(resolveBevel3D(0.3)).toEqual({ size: 0.3, thickness: 0.6, offset: 0, segments: 3 });
    });

    it('treats a bare zero as a size of 0 rather than as no bevel', () => {
        expect(resolveBevel3D(0)).toEqual({ size: 0, thickness: 0, offset: 0, segments: 3 });
    });

    it('defaults an empty object to size 0.1, thickness 0.2, offset 0, segments 3', () => {
        expect(resolveBevel3D({})).toEqual({ size: 0.1, thickness: 0.2, offset: 0, segments: 3 });
    });

    it('applies the fields it is given and derives the thickness from the size it ends up with', () => {
        expect(resolveBevel3D({ size: 0.5 })).toEqual({ size: 0.5, thickness: 1, offset: 0, segments: 3 });
        expect(resolveBevel3D({ thickness: 0.05 })).toEqual({ size: 0.1, thickness: 0.05, offset: 0, segments: 3 });
        expect(resolveBevel3D({ size: 1, thickness: 4, offset: -0.2, segments: 8 }))
            .toEqual({ size: 1, thickness: 4, offset: -0.2, segments: 8 });
    });
});

describe('shadow participation', () => {
    const modes: [string, Shadow3D | undefined, boolean, boolean][] = [
        // [label, mode, casts, receives]
        ['undefined', undefined, true, true],
        ['true', true, true, true],
        ['false', false, false, false],
        ['"cast"', 'cast', true, false],
        ['"receive"', 'receive', false, true],
        ['an empty options object', {}, true, true],
        ['an options object', { softness: 0.8 }, true, true],
    ];

    it.each(modes)('%s: casts=%s receives=%s', (_label, mode, casts, receives) => {
        expect(shadowCasts(mode)).toBe(casts);
        expect(shadowReceives(mode)).toBe(receives);
    });

    it('resolves the options of a light that casts', () => {
        expect(resolveShadowOptions3D(undefined)).toEqual({});
        expect(resolveShadowOptions3D(true)).toEqual({});
        expect(resolveShadowOptions3D('cast')).toEqual({});
        const options = { softness: 0.9, extent: 12 };
        expect(resolveShadowOptions3D(options)).toBe(options);
    });

    it('resolves to null when the mode does not cast', () => {
        expect(resolveShadowOptions3D(false)).toBeNull();
        expect(resolveShadowOptions3D('receive')).toBeNull();
    });
});
