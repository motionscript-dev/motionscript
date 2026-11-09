import { describe, expect, it } from 'vitest';
import {
    isOrbitCamera3D, resolveCameraPlacement,
    type CameraData3D,
} from '@/render3d/camera';

const perspective = (fields: Omit<Extract<CameraData3D, { type: 'perspective' }>, 'type'> = {}): CameraData3D => ({
    type: 'perspective',
    ...fields,
});

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);

describe('isOrbitCamera3D', () => {
    it('is true as soon as orbit, elevation or distance is defined', () => {
        expect(isOrbitCamera3D(perspective({ orbit: 0 }))).toBe(true);
        expect(isOrbitCamera3D(perspective({ elevation: 0 }))).toBe(true);
        expect(isOrbitCamera3D(perspective({ distance: 0 }))).toBe(true);
    });

    it('is false for target, position and lookAt alone: naming a subject is not a placement', () => {
        expect(isOrbitCamera3D(perspective())).toBe(false);
        expect(isOrbitCamera3D(perspective({ target: [1, 2, 3] }))).toBe(false);
        expect(isOrbitCamera3D(perspective({ position: [0, 0, 5], lookAt: 0 }))).toBe(false);
    });
});

describe('resolveCameraPlacement: polar', () => {
    it('defaults to distance 10 at azimuth 0 and elevation 0, so it sits on +Z looking at the origin', () => {
        const { position, lookAt } = resolveCameraPlacement(perspective({ orbit: 0 }));
        close(position.x, 0);
        close(position.y, 0);
        close(position.z, 10);
        expect(lookAt).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('applies x = tx + sin(az)cos(el)d, y = ty + sin(el)d, z = tz + cos(az)cos(el)d about the target', () => {
        const azimuth = 40;
        const elevation = 25;
        const distance = 7;
        const { position, lookAt } = resolveCameraPlacement(perspective({
            target: [1, 2, 3], orbit: azimuth, elevation, distance,
        }));
        const az = (azimuth * Math.PI) / 180;
        const el = (elevation * Math.PI) / 180;

        close(position.x, 1 + Math.sin(az) * Math.cos(el) * distance);
        close(position.y, 2 + Math.sin(el) * distance);
        close(position.z, 3 + Math.cos(az) * Math.cos(el) * distance);
        expect(lookAt).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('is exactly `distance` from the target whatever the angles', () => {
        for (const [orbit, elevation] of [[0, 0], [90, 30], [-135, -60], [200, 89]]) {
            const { position } = resolveCameraPlacement(perspective({ orbit, elevation, distance: 6 }));
            close(Math.hypot(position.x, position.y, position.z), 6);
        }
    });

    it('turns an orbit of 90 degrees toward +X', () => {
        const { position } = resolveCameraPlacement(perspective({ orbit: 90, distance: 4 }));
        close(position.x, 4);
        close(position.z, 0);
    });

    it('clamps the elevation to 89.9 degrees, so the pole never makes the view parallel to up', () => {
        const over = resolveCameraPlacement(perspective({ elevation: 90, distance: 10 }));
        const edge = resolveCameraPlacement(perspective({ elevation: 89.9, distance: 10 }));
        const far = resolveCameraPlacement(perspective({ elevation: 1000, distance: 10 }));
        expect(over.position).toEqual(edge.position);
        expect(far.position).toEqual(edge.position);
        // Not exactly vertical: a horizontal component remains.
        expect(Math.hypot(over.position.x, over.position.z)).toBeGreaterThan(0);
        close(over.position.y, 10 * Math.sin((89.9 * Math.PI) / 180));

        const under = resolveCameraPlacement(perspective({ elevation: -90, distance: 10 }));
        close(under.position.y, -over.position.y);
    });

    it('lets a polar field discard a position stated beside it', () => {
        const { position, lookAt } = resolveCameraPlacement(perspective({
            position: [50, 50, 50], lookAt: [9, 9, 9], distance: 3,
        }));
        expect(position).toEqual({ x: 0, y: 0, z: 3 });
        // The polar half aims at `target` (the origin), not at the lost `lookAt`.
        expect(lookAt).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('places an orthographic camera by the same rule', () => {
        const { position } = resolveCameraPlacement({
            type: 'orthographic', orbit: 90, elevation: 0, distance: 5,
        });
        close(position.x, 5);
        close(position.y, 0);
    });
});

describe('resolveCameraPlacement: positional', () => {
    it('returns the position and leaves the aim undefined when no lookAt or target is given', () => {
        expect(resolveCameraPlacement(perspective({ position: [1, 2, 3] }))).toEqual({
            position: { x: 1, y: 2, z: 3 },
            lookAt: undefined,
        });
    });

    it('defaults the position to the origin', () => {
        expect(resolveCameraPlacement(perspective()).position).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('aims at lookAt', () => {
        expect(resolveCameraPlacement(perspective({ position: [0, 0, 5], lookAt: [1, 1, 1] }))).toEqual({
            position: { x: 0, y: 0, z: 5 },
            lookAt: { x: 1, y: 1, z: 1 },
        });
    });

    it('aims a positioned camera at target alone, which is lookAt under another name', () => {
        expect(resolveCameraPlacement(perspective({ position: [0, 0, 5], target: [2, 0, 0] }))).toEqual({
            position: { x: 0, y: 0, z: 5 },
            lookAt: { x: 2, y: 0, z: 0 },
        });
    });

    it('prefers lookAt over target when both are stated', () => {
        const { lookAt } = resolveCameraPlacement(perspective({ lookAt: [1, 0, 0], target: [0, 1, 0] }));
        expect(lookAt).toEqual({ x: 1, y: 0, z: 0 });
    });

    it('broadcasts a scalar position and aim', () => {
        const placed = resolveCameraPlacement(perspective({ position: 2, lookAt: 0 }));
        expect(placed.position).toEqual({ x: 2, y: 2, z: 2 });
        expect(placed.lookAt).toEqual({ x: 0, y: 0, z: 0 });
    });
});
