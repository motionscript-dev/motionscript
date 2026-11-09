import { describe, expect, it } from 'vitest';
import {
    cameraOrbit, lerpColor3D, lerpCount, lerpFinite, orbitPosition, orbitProps,
    resolveColor3D, snapFlag, snapValue,
} from '@/attributes/render3d/orbit';
import { parseColor } from '@/attributes/shape/fill/color/parser';
import { resolveCameraPlacement } from '@/render3d/camera';

describe('resolveColor3D', () => {
    it('parses a colour string to a normalized RGBA tuple', () => {
        expect(resolveColor3D('#ff8000')).toEqual(parseColor('#ff8000'));
        const [r, g, b, a] = resolveColor3D('#ff0000');
        expect([r, g, b, a]).toEqual([1, 0, 0, 1]);
    });

    it('passes an already normalized tuple through untouched', () => {
        const tuple: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
        expect(resolveColor3D(tuple)).toBe(tuple);
    });
});

describe('lerpColor3D', () => {
    it('interpolates every channel, alpha included', () => {
        expect(lerpColor3D([0, 0, 0, 0], [1, 0.5, 0.25, 1], 0.5)).toEqual([0.5, 0.25, 0.125, 0.5]);
    });

    it('returns the endpoints at t = 0 and t = 1', () => {
        const from: [number, number, number, number] = [0.1, 0.2, 0.3, 1];
        const to: [number, number, number, number] = [0.9, 0.8, 0.7, 0.5];
        expect(lerpColor3D(from, to, 0)).toEqual(from);
        expect(lerpColor3D(from, to, 1)).toEqual(to);
    });

    it('allocates a new tuple rather than returning an endpoint', () => {
        const from: [number, number, number, number] = [0, 0, 0, 1];
        expect(lerpColor3D(from, from, 0.3)).not.toBe(from);
    });
});

describe('lerpFinite', () => {
    it('interpolates two finite numbers', () => {
        expect(lerpFinite(0, 10, 0.25)).toBe(2.5);
        expect(lerpFinite(10, 0, 1)).toBe(0);
    });

    it('holds the start while a non-finite end is approached, and lands on the end at t = 1', () => {
        expect(lerpFinite(5, Infinity, 0)).toBe(5);
        expect(lerpFinite(5, Infinity, 0.99)).toBe(5);
        expect(lerpFinite(5, Infinity, 1)).toBe(Infinity);
        expect(lerpFinite(Infinity, 5, 0.5)).toBe(Infinity);
        expect(lerpFinite(Infinity, 5, 1)).toBe(5);
        expect(lerpFinite(-Infinity, Infinity, 0.5)).toBe(-Infinity);
    });

    it('never produces NaN from an infinite pair', () => {
        for (const t of [0, 0.3, 1]) expect(Number.isNaN(lerpFinite(Infinity, Infinity, t))).toBe(false);
        // NaN as an endpoint is not finite either, so it holds like an infinity.
        expect(lerpFinite(2, NaN, 0.5)).toBe(2);
    });
});

describe('lerpCount', () => {
    it('rounds the interpolated value', () => {
        expect(lerpCount(0, 10, 0.34)).toBe(3);
        expect(lerpCount(0, 10, 0.36)).toBe(4);
        expect(lerpCount(4, 8, 0.5)).toBe(6);
    });

    it('lands exactly on both endpoints', () => {
        expect(lerpCount(3, 9, 0)).toBe(3);
        expect(lerpCount(3, 9, 1)).toBe(9);
    });
});

describe('snapValue and snapFlag', () => {
    it('hold the start until t reaches 1', () => {
        expect(snapValue('a', 'b', 0)).toBe('a');
        expect(snapValue('a', 'b', 0.999)).toBe('a');
        expect(snapValue('a', 'b', 1)).toBe('b');
        expect(snapFlag(false, true, 0.5)).toBe(false);
        expect(snapFlag(false, true, 1)).toBe(true);
    });

    it('hand back the very object of the chosen side', () => {
        const from = { id: 1 };
        const to = { id: 2 };
        expect(snapValue(from, to, 0.5)).toBe(from);
        expect(snapValue(from, to, 1)).toBe(to);
    });
});

describe('cameraOrbit', () => {
    it('is the quarter turn between the stored zero (+X) and the camera zero (+Z)', () => {
        expect(cameraOrbit(0)).toBe(90);
        expect(cameraOrbit(90)).toBe(0);
        expect(cameraOrbit(35)).toBe(55);
        expect(cameraOrbit(-30)).toBe(120);
    });

    it('agrees with orbitPosition: a stored orbit places the camera where orbitPosition does', () => {
        for (const stored of [0, 35, 90, -60, 200]) {
            const spherical = orbitPosition({ orbit: stored, elevation: 20, distance: 12 });
            const camera = resolveCameraPlacement({
                type: 'perspective', orbit: cameraOrbit(stored), elevation: 20, distance: 12,
            }).position;
            expect(camera.x).toBeCloseTo(spherical.x, 9);
            expect(camera.y).toBeCloseTo(spherical.y, 9);
            expect(camera.z).toBeCloseTo(spherical.z, 9);
        }
    });
});

describe('orbitPosition', () => {
    it('measures the angle from +X', () => {
        const p = orbitPosition({ orbit: 0, elevation: 0, distance: 5 });
        expect(p.x).toBeCloseTo(5, 9);
        expect(p.y).toBeCloseTo(0, 9);
        expect(p.z).toBeCloseTo(0, 9);

        const q = orbitPosition({ orbit: 90, elevation: 0, distance: 5 });
        expect(q.x).toBeCloseTo(0, 9);
        expect(q.z).toBeCloseTo(5, 9);
    });

    it('lifts by the elevation: straight up at 90 degrees', () => {
        const top = orbitPosition({ orbit: 40, elevation: 90, distance: 7 });
        expect(top.y).toBeCloseTo(7, 9);
        expect(top.x).toBeCloseTo(0, 9);
        expect(top.z).toBeCloseTo(0, 9);
    });

    it('is always `distance` from the origin', () => {
        for (const [orbit, elevation] of [[10, 10], [135, -40], [-70, 65]]) {
            const p = orbitPosition({ orbit, elevation, distance: 9 });
            expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(9, 9);
        }
    });
});

describe('orbitProps', () => {
    it('keeps only the axes the target names', () => {
        expect(orbitProps({ orbit: 120 })).toEqual({ orbit: 120 });
        expect(orbitProps({ elevation: 10, zoom: 3 })).toEqual({ elevation: 10, zoom: 3 });
        expect(orbitProps({ orbit: 1, elevation: 2, zoom: 3 })).toEqual({ orbit: 1, elevation: 2, zoom: 3 });
    });

    it('leaves an undefined axis out entirely instead of writing undefined', () => {
        const props = orbitProps({ orbit: 5, elevation: undefined });
        expect(Object.keys(props)).toEqual(['orbit']);
        expect(orbitProps({})).toEqual({});
    });

    it('keeps an axis stated as zero', () => {
        expect(orbitProps({ orbit: 0, zoom: 0 })).toEqual({ orbit: 0, zoom: 0 });
    });
});
