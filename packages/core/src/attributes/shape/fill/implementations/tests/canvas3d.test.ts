import { describe, it, expect, vi } from 'vitest';
import { resolveFill, lerpFill, canLerpFill, declareFill, fillOps } from '@/attributes/shape/fill/registry';
import { Fills } from '@/attributes/shape/fill/chain';
import { Graphics3D } from '@/render3d/graphics3d';
import { Scene3D } from '@/render3d/scene3d';
import { canvas3DFill, type Canvas3DFillResolved } from '@/attributes/shape/fill/implementations/canvas3d';
import type { FillResolved } from '@/attributes/shape/fill/union';
import type { AssetScope } from '@/assets/scope';

const scene = (build: (g3: Graphics3D) => unknown = (g3) => g3.box()) => {
    const g3 = new Graphics3D();
    build(g3);
    return new Scene3D().draw(g3);
};

const fill = (s3: Scene3D, opacity?: number): FillResolved =>
    resolveFill({ type: 'canvas3D', scene: s3, opacity });

describe('canvas3D fill', () => {
    it('coerces a bare Scene3D, the way a bare string coerces to a solid fill', () => {
        const g3 = scene();
        const resolved = resolveFill(g3) as Canvas3DFillResolved;

        expect(resolved.type).toBe('canvas3D');
        expect(resolved.scene).toBe(g3);
    });

    it('coerces inside a mixed fill array, so `fill={["#0b0d12", scene]}` works', () => {
        const g3 = scene();
        const resolved = fillOps.resolve(['#0b0d12', g3]);

        expect(resolved.map((f) => f.type)).toEqual(['solid', 'canvas3D']);
        // Array order is paint order: the backdrop paints beneath the 3D.
        expect((resolved[1] as Canvas3DFillResolved).scene).toBe(g3);
    });

    it('carries maxPixelRatio/antialias and the cross-cutting options through the chain', () => {
        const g3 = scene();
        const [resolved] = fillOps.resolve(
            Fills.canvas3D(g3, { maxPixelRatio: 1, antialias: false, opacity: 0.5, blend: 'screen', space: 'global' }),
        ) as Canvas3DFillResolved[];

        expect(resolved).toMatchObject({
            type: 'canvas3D', maxPixelRatio: 1, antialias: false, opacity: 0.5, blend: 'screen', space: 'global',
        });
    });

    // A command list has no meaningful halfway value, so it snaps — exactly as an
    // image fill's `src` does.
    it('snaps the scene at the tween midpoint and interpolates only opacity', () => {
        const a = scene((g3) => g3.box());
        const b = scene((g3) => g3.sphere());

        const at = (t: number) => lerpFill(fill(a, 0), fill(b, 1), t) as Canvas3DFillResolved;

        expect(at(0.25).scene).toBe(a);
        expect(at(0.75).scene).toBe(b);
        expect(at(0.25).opacity).toBeCloseTo(0.25);
        expect(at(0.75).opacity).toBeCloseTo(0.75);
    });

    it('preserves type/blend/space across a lerp, which lerp() itself must not return', () => {
        const g3 = scene();
        const from = resolveFill({ type: 'canvas3D', scene: g3, blend: 'multiply', space: 'parent' });
        const to = resolveFill({ type: 'canvas3D', scene: g3, blend: 'multiply', space: 'parent' });

        expect(lerpFill(from, to, 0.5)).toMatchObject({ type: 'canvas3D', blend: 'multiply', space: 'parent' });
    });

    // The ragged-array branch: a fill with no counterpart fades against a copy of
    // itself, which routes back into our own lerp as a same-type self-pair.
    it('fades out against itself when the target array is shorter', () => {
        const g3 = scene();
        const out = fillOps.lerp([fill(g3)], [], 0.25) as Canvas3DFillResolved[];

        expect(out).toHaveLength(1);
        expect(out[0].type).toBe('canvas3D');
        expect(out[0].scene).toBe(g3);
        expect(out[0].opacity).toBeCloseTo(0.75);
    });

    it('cross-fades against another fill type rather than throwing', () => {
        const g3 = scene();
        expect(canLerpFill(fill(g3), resolveFill('red'))).toBe(false);

        const out = fillOps.lerp([resolveFill('red')], [fill(g3)], 0.25);
        // Outgoing beneath, incoming on top.
        expect(out.map((f) => f.type)).toEqual(['solid', 'canvas3D']);
        expect(out[0].opacity).toBeCloseTo(0.75);
        expect(out[1].opacity).toBeCloseTo(0.25);
    });

    it('declares the scene\'s textures', () => {
        const g3 = scene((s) => s.box({ fill: '/wood.png' }).sphere({ fill: '/metal.png' }));
        const image = vi.fn();
        const assets = { image, loader: vi.fn(), subtree: vi.fn() } as unknown as AssetScope;

        declareFill(fill(g3), assets);

        expect(image).toHaveBeenCalledWith('/wood.png');
        expect(image).toHaveBeenCalledWith('/metal.png');
    });
});

describe('canvas3D fill equality', () => {
    it('is reference identity of the scene', () => {
        const a = scene();
        expect(canvas3DFill.equals(fill(a) as Canvas3DFillResolved, fill(a) as Canvas3DFillResolved)).toBe(true);
    });

    it('tells two scenes apart even when they record the same thing', () => {
        const a = scene();
        const b = scene();
        expect(canvas3DFill.equals(fill(a) as Canvas3DFillResolved, fill(b) as Canvas3DFillResolved)).toBe(false);
    });

    it('ignores opacity and the render options, which are not the scene', () => {
        const a = scene();
        const left = resolveFill({ type: 'canvas3D', scene: a, opacity: 0.2, maxPixelRatio: 1, antialias: false }) as Canvas3DFillResolved;
        const right = resolveFill({ type: 'canvas3D', scene: a, opacity: 0.9, maxPixelRatio: 3, antialias: true }) as Canvas3DFillResolved;
        expect(canvas3DFill.equals(left, right)).toBe(true);
    });
});
