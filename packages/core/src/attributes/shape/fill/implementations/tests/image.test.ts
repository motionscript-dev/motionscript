import { describe, it, expect, vi } from 'vitest';
import { resolveFill, lerpFill, declareFill } from '@/attributes/shape/fill/registry';
import { Adjustments } from '@/attributes/shape/filters/chain';
import type { AssetScope } from '@/assets/scope';
import { Fills } from '@/attributes/shape/fill/chain';
import type { ImageFillProp, ImageFillResolved } from '@/attributes/shape/fill/implementations/image';
import type { InsetsResolved } from '@/attributes/layout/insets';
import type { Vector2 } from '@/attributes/layout/vector2';

const SRC = 'photo.jpg';

function image(prop: Partial<ImageFillProp> = {}): ImageFillResolved {
    return resolveFill({ type: 'image', src: SRC, ...prop } as ImageFillProp) as ImageFillResolved;
}

describe('image fill placement — resolve', () => {
    it('leaves crop and anchor undefined when unset, so the cheap path stays cheap', () => {
        const fill = image();
        expect(fill.crop).toBeUndefined();
        expect(fill.anchor).toBeUndefined();
        expect(fill.zoom).toBeUndefined();
    });

    it('resolves a crop through the Insets shorthands', () => {
        expect(image({ crop: 0.1 }).crop).toEqual({ left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 });
        expect(image({ crop: { horizontal: 0.2 } }).crop).toEqual({ left: 0.2, right: 0.2, top: 0, bottom: 0 });
        expect(image({ crop: { left: 0.1, top: 0.05 } }).crop).toEqual({ left: 0.1, right: 0, top: 0.05, bottom: 0 });
    });

    it('resolves a named anchor into the [-1,1] y-up space shared with pivot/align', () => {
        expect(image({ anchor: 'center' }).anchor).toEqual({ x: 0, y: 0 });
        expect(image({ anchor: 'topLeft' }).anchor).toEqual({ x: -1, y: 1 });
        expect(image({ anchor: 'bottomRight' }).anchor).toEqual({ x: 1, y: -1 });
        expect(image({ anchor: { x: 0.5, y: -0.25 } }).anchor).toEqual({ x: 0.5, y: -0.25 });
    });

    it('is idempotent — a resolved fill re-resolves to itself', () => {
        const once = image({ crop: { horizontal: 0.2 }, anchor: 'topRight', zoom: 2 });
        const twice = resolveFill(once as never) as ImageFillResolved;
        expect(twice.crop).toEqual(once.crop);
        expect(twice.anchor).toEqual(once.anchor);
    });
});

describe('image fill placement — lerp', () => {
    const from = image({ zoom: 1, anchor: 'center' });
    const to = image({ zoom: 3, anchor: 'centerRight' });

    it('interpolates zoom', () => {
        expect((lerpFill(from, to, 0.5) as ImageFillResolved).zoom).toBeCloseTo(2);
    });

    it('slides the anchor rather than snapping it', () => {
        const mid = (lerpFill(from, to, 0.5) as ImageFillResolved).anchor as Vector2;
        expect(mid.x).toBeCloseTo(0.5);
        expect(mid.y).toBeCloseTo(0);
    });

    it('opens a crop from nothing, treating the uncropped side as zero', () => {
        const uncropped = image();
        const cropped = image({ crop: { horizontal: 0.4 } });
        const mid = (lerpFill(uncropped, cropped, 0.5) as ImageFillResolved).crop as InsetsResolved;
        expect(mid).toEqual({ left: 0.2, right: 0.2, top: 0, bottom: 0 });
    });

    it('stays uncropped when neither side crops', () => {
        expect((lerpFill(image(), image({ zoom: 2 }), 0.5) as ImageFillResolved).crop).toBeUndefined();
    });

    it('defaults a missing zoom to 1 rather than 0, so a fill never collapses mid-tween', () => {
        const mid = (lerpFill(image(), image({ zoom: 5 }), 0.5) as ImageFillResolved).zoom;
        expect(mid).toBeCloseTo(3);
    });
});

describe('image fill placement — fit and matrix switch to the destination', () => {
    const m1 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const m2 = [[2, 0, 0], [0, 2, 0], [0, 0, 1]];
    const from = image({ fit: 'fill', matrix: m1 });
    const to = image({ fit: 'fit', matrix: m2, src: 'other.jpg' });
    const at = (t: number) => lerpFill(from, to, t) as ImageFillResolved;

    it('holds the source until the midpoint and takes the destination from it', () => {
        expect(at(0).fit).toBe('fill');
        expect(at(0.49).fit).toBe('fill');
        expect(at(0.5).fit).toBe('fit');
        expect(at(1).fit).toBe('fit');
        expect(at(0.49).matrix).toBe(m1);
        expect(at(0.5).matrix).toBe(m2);
    });

    it('ends on the destination when only the destination states them', () => {
        const end = lerpFill(image(), to, 1) as ImageFillResolved;
        expect(end.fit).toBe('fit');
        expect(end.matrix).toBe(m2);
    });

    it('drops the matrix when the destination has none', () => {
        expect((lerpFill(from, image({ fit: 'fill' }), 1) as ImageFillResolved).matrix).toBeUndefined();
    });
});

describe('Fills.image builder', () => {
    it('carries the placement options onto the prop', () => {
        const [layer] = Fills.image(SRC, { fit: 'fit', crop: 0.25, zoom: 1.5, anchor: 'topLeft' }).list;
        expect(layer).toMatchObject({ type: 'image', src: SRC, fit: 'fit', crop: 0.25, zoom: 1.5, anchor: 'topLeft' });
    });
});

describe('imageFill.declare', () => {
    const declare = (prop: Partial<ImageFillProp> = {}) => {
        const scope = { image: vi.fn(), video: vi.fn(), loader: vi.fn() };
        declareFill(image(prop), scope as unknown as AssetScope);
        return scope;
    };

    it('declares the picture itself', () => {
        const scope = declare();
        expect(scope.image).toHaveBeenCalledTimes(1);
        expect(scope.image).toHaveBeenCalledWith(SRC);
    });

    it('declares nothing past the picture for adjustments that load nothing', () => {
        const scope = declare({ preset: { adjustments: Adjustments.grayscale(0.5).blur(3) } });
        expect(scope.image).toHaveBeenCalledTimes(1);
        expect(scope.loader).not.toHaveBeenCalled();
    });

    it('declares no video', () => {
        expect(declare().video).not.toHaveBeenCalled();
    });
});
