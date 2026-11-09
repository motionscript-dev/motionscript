import { describe, it, expect, vi } from 'vitest';
import {
    resolveFill, lerpFill, canLerpFill, declareFill, fillOps, UNSET_MEDIA_FILL,
} from '@/attributes/shape/fill/registry';
import { Fills } from '@/attributes/shape/fill/chain';
import type { FillProp, FillResolved } from '@/attributes/shape/fill/union';
import type { AssetScope } from '@/assets/scope';

const RED: [number, number, number, number] = [1, 0, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];

const solid = (color = RED, extra: Record<string, unknown> = {}): FillResolved =>
    resolveFill({ type: 'solid', color, ...extra } as FillProp);

describe('resolveFill', () => {
    it('throws, naming the type, for a type no one registered', () => {
        expect(() => resolveFill({ type: 'plasma' } as never)).toThrow('Fill "plasma" is not registered');
    });

    it('reads a bare string as a solid fill', () => {
        expect(resolveFill('red')).toMatchObject({ type: 'solid', color: [1, 0, 0, 1] });
    });

    it('carries `space` through when the prop names one, for every kind', () => {
        expect(resolveFill({ type: 'solid', color: 'red', space: 'global' }).space).toBe('global');
        expect(resolveFill({ type: 'linear-gradient', colors: ['red', 'blue'], space: 'parent' }).space).toBe('parent');
        expect(resolveFill({ type: 'noise', space: 'local' }).space).toBe('local');
    });

    it('leaves `space` off the resolved fill, as a key, when the prop has none', () => {
        const resolved = resolveFill({ type: 'solid', color: 'red' });
        expect('space' in resolved).toBe(false);
        expect('space' in resolveFill('red')).toBe(false);
    });

    it('treats an explicit `space: undefined` as none', () => {
        expect('space' in resolveFill({ type: 'solid', color: 'red', space: undefined })).toBe(false);
    });

    it('keeps opacity and blend as the kind resolves them', () => {
        expect(resolveFill({ type: 'solid', color: 'red', opacity: 0.4, blend: 'screen' })).toMatchObject({ opacity: 0.4, blend: 'screen' });
    });

    it('resolves an already-resolved fill to an equal one', () => {
        for (const prop of [
            'red',
            { type: 'linear-gradient', colors: ['red', 'blue'], opacity: 0.5, space: 'global' },
            { type: 'fractalNoise', octaves: 20 },
            { type: 'grid', strokeWidth: 3 },
            { type: 'stripe' },
        ] as FillProp[]) {
            const once = resolveFill(prop);
            expect(resolveFill(once as FillProp)).toEqual(once);
        }
    });
});

describe('UNSET_MEDIA_FILL', () => {
    it('is an image fill naming no source', () => {
        expect(UNSET_MEDIA_FILL.type).toBe('image');
        expect((UNSET_MEDIA_FILL as { src: string }).src).toBe('');
    });

    it('is what an image fill with an empty src resolves to', () => {
        expect(UNSET_MEDIA_FILL).toEqual(resolveFill({ type: 'image', src: '' } as FillProp));
    });

    it('is resolved once, so every reader holds the same object', async () => {
        const again = (await import('@/attributes/shape/fill/registry')).UNSET_MEDIA_FILL;
        expect(again).toBe(UNSET_MEDIA_FILL);
    });

    it('is not touched by interpolating against it', () => {
        const before = JSON.stringify(UNSET_MEDIA_FILL);
        fillOps.lerp([UNSET_MEDIA_FILL], [solid(RED)], 0.5);
        fillOps.lerp([solid(RED)], [UNSET_MEDIA_FILL], 0.5);
        expect(JSON.stringify(UNSET_MEDIA_FILL)).toBe(before);
    });
});

describe('fillOps.resolve', () => {
    it('gives no layers for nothing', () => {
        expect(fillOps.resolve(undefined as never)).toEqual([]);
        expect(fillOps.resolve([])).toEqual([]);
    });

    it('resolves a string, a prop, a chain and an array of them to layers', () => {
        expect(fillOps.resolve('red')).toHaveLength(1);
        expect(fillOps.resolve({ type: 'noise' })).toHaveLength(1);
        expect(fillOps.resolve(Fills.color('red').color('blue'))).toHaveLength(2);
        expect(fillOps.resolve(['red', Fills.color('blue').color('green'), 'white'])).toHaveLength(4);
    });
});

describe('fillOps.lerp', () => {
    it('returns `from` itself when from is to', () => {
        const same = fillOps.resolve('red');
        expect(fillOps.lerp(same, same, 0.5)).toBe(same);
    });

    it('returns an empty array for two empty arrays, a new one each time', () => {
        const empty: FillResolved[] = [];
        const out = fillOps.lerp(empty, [], 0.5);
        expect(out).toEqual([]);
        expect(out).not.toBe(empty);
    });

    it('returns the very same array for two empty arrays that are one object', () => {
        const empty: FillResolved[] = [];
        expect(fillOps.lerp(empty, empty, 0.5)).toBe(empty);
    });

    it('clamps t below 0 to the source and above 1 to the destination', () => {
        const from = [solid(RED)];
        const to = [solid(BLUE)];
        expect(fillOps.lerp(from, to, -3)).toEqual(fillOps.lerp(from, to, 0));
        expect(fillOps.lerp(from, to, 9)).toEqual(fillOps.lerp(from, to, 1));
        expect((fillOps.lerp(from, to, 9)[0] as { color: number[] }).color).toEqual(BLUE);
    });

    it('clamps t for a cross-fade, too', () => {
        const from = [solid(RED)];
        const to = [resolveFill({ type: 'image', src: 'a.png' } as FillProp)];
        expect(fillOps.lerp(from, to, -1)).toEqual(fillOps.lerp(from, to, 0));
        expect(fillOps.lerp(from, to, 2)).toEqual(fillOps.lerp(from, to, 1));
    });

    it('interpolates a ragged array layer by layer, fading the layer the other side lacks', () => {
        const out = fillOps.lerp([solid(RED)], [solid(RED), solid(BLUE)], 0.5);
        expect(out).toHaveLength(2);
        expect(out[1].opacity).toBeCloseTo(0.5);
        const shrinking = fillOps.lerp([solid(RED), solid(BLUE)], [solid(RED)], 0.5);
        expect(shrinking).toHaveLength(2);
        expect(shrinking[1].opacity).toBeCloseTo(0.5);
    });

    it('does not write to either array', () => {
        const from = [solid(RED)];
        const to = [solid(BLUE), solid(RED)];
        const before = JSON.stringify([from, to]);
        fillOps.lerp(from, to, 0.5);
        expect(JSON.stringify([from, to])).toBe(before);
    });
});

describe('canLerpFill and lerpFill', () => {
    it('agree on a same-type pair with one blend', () => {
        expect(canLerpFill(solid(RED), solid(BLUE))).toBe(true);
        expect(canLerpFill(solid(RED, { blend: 'screen' }), solid(BLUE, { blend: 'screen' }))).toBe(true);
    });

    it('refuse a same-type pair whose blend modes differ, and lerpFill throws on it', () => {
        const a = solid(RED, { blend: 'screen' });
        const b = solid(BLUE, { blend: 'multiply' });
        expect(canLerpFill(a, b)).toBe(false);
        expect(() => lerpFill(a, b, 0.5)).toThrow('No registered lerp for fills of type "solid" and "solid"');
    });

    it('allow a colour and a gradient, which coerce to one type', () => {
        const gradient = resolveFill({ type: 'linear-gradient', colors: [RED, BLUE] });
        expect(canLerpFill(solid(RED), gradient)).toBe(true);
    });

    it('refuse unrelated kinds, and lerpFill throws on them', () => {
        const image = resolveFill({ type: 'image', src: 'a.png' } as FillProp);
        const video = resolveFill({ type: 'video', src: 'a.mp4' } as FillProp);
        expect(canLerpFill(solid(RED), image)).toBe(false);
        expect(canLerpFill(image, video)).toBe(false);
        expect(() => lerpFill(solid(RED), image, 0.5)).toThrow('No registered lerp for fills of type "solid" and "image"');
    });

    it('clamps t itself', () => {
        expect(lerpFill(solid(RED), solid(BLUE), -2)).toEqual(lerpFill(solid(RED), solid(BLUE), 0));
        expect(lerpFill(solid(RED), solid(BLUE), 5)).toEqual(lerpFill(solid(RED), solid(BLUE), 1));
    });
});

describe('declareFill', () => {
    it('does nothing for a kind that loads nothing', () => {
        const scope = { image: vi.fn(), loader: vi.fn() } as unknown as AssetScope;
        declareFill(solid(RED), scope);
        expect(scope.image).not.toHaveBeenCalled();
        expect(scope.loader).not.toHaveBeenCalled();
    });

    it('does nothing for a type no one registered', () => {
        const scope = { image: vi.fn() } as unknown as AssetScope;
        expect(() => declareFill({ type: 'plasma' } as never, scope)).not.toThrow();
        expect(scope.image).not.toHaveBeenCalled();
    });
});
