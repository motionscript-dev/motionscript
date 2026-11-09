import { describe, expect, it } from 'vitest';
import {
    euler3Ops, IDENTITY_QUATERNION, normalizeQuaternion, quaternionFromEuler, quaternionOps,
    slerpQuaternion, vector3Ops, lerpOptionalVector3, resolveOptionalVector3, resolveVector3,
    type Euler3, type EulerOrder, type Quaternion,
} from '@/render3d/vector3';

/** Hamilton product, the oracle the Euler-order cases compose against. */
function multiply(a: Quaternion, b: Quaternion): Quaternion {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

/** A rotation of `degrees` about one axis. */
function about(axis: 'x' | 'y' | 'z', degrees: number): Quaternion {
    const half = (degrees * Math.PI) / 360;
    return { x: 0, y: 0, z: 0, w: Math.cos(half), [axis]: Math.sin(half) } as unknown as Quaternion;
}

const expectQuaternion = (actual: Quaternion, expected: Quaternion) => {
    for (const key of ['x', 'y', 'z', 'w'] as const) expect(actual[key]).toBeCloseTo(expected[key], 9);
};

describe('quaternionFromEuler: the six orders', () => {
    // three's order names the axes in the order the rotation matrix multiplies
    // them: "XYZ" is Rx * Ry * Rz, so a vector is turned about Z first.
    const compose: Record<EulerOrder, ('x' | 'y' | 'z')[]> = {
        XYZ: ['x', 'y', 'z'],
        YXZ: ['y', 'x', 'z'],
        ZXY: ['z', 'x', 'y'],
        ZYX: ['z', 'y', 'x'],
        YZX: ['y', 'z', 'x'],
        XZY: ['x', 'z', 'y'],
    };
    const angles = { x: 30, y: 40, z: 50 };

    it.each(Object.keys(compose) as EulerOrder[])('%s composes the three axis rotations in that order', (order) => {
        const [first, second, third] = compose[order];
        const expected = multiply(multiply(about(first, angles[first]), about(second, angles[second])), about(third, angles[third]));
        expectQuaternion(quaternionFromEuler({ ...angles, order }), expected);
    });

    it('defaults to XYZ when the order is absent', () => {
        expectQuaternion(quaternionFromEuler(angles), quaternionFromEuler({ ...angles, order: 'XYZ' }));
    });

    it('returns a unit quaternion for every order', () => {
        for (const order of Object.keys(compose) as EulerOrder[]) {
            const q = quaternionFromEuler({ x: 70, y: -120, z: 15, order });
            expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
        }
    });

    it('gives different rotations for different orders when more than one axis turns', () => {
        const xyz = quaternionFromEuler({ ...angles, order: 'XYZ' });
        const zyx = quaternionFromEuler({ ...angles, order: 'ZYX' });
        expect(Math.abs(xyz.x - zyx.x) + Math.abs(xyz.y - zyx.y) + Math.abs(xyz.z - zyx.z)).toBeGreaterThan(0.01);
    });

    it('agrees across orders when only one axis turns', () => {
        const only = { x: 0, y: 65, z: 0 };
        const reference = quaternionFromEuler({ ...only, order: 'XYZ' });
        for (const order of Object.keys(compose) as EulerOrder[]) {
            expectQuaternion(quaternionFromEuler({ ...only, order }), reference);
        }
    });
});

describe('the attribute ops values', () => {
    it('vector3Ops resolves any input form and lerps per component', () => {
        expect(vector3Ops.resolve(2)).toEqual({ x: 2, y: 2, z: 2 });
        expect(vector3Ops.resolve([1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 });
        expect(vector3Ops.lerp({ x: 0, y: 0, z: 0 }, { x: 4, y: 8, z: 12 }, 0.25)).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('euler3Ops resolves a vector with no order to a plain vector, and keeps a stated order', () => {
        expect(euler3Ops.resolve([10, 20, 30])).toEqual({ x: 10, y: 20, z: 30 });
        expect(euler3Ops.resolve({ x: 10, y: 20, z: 30, order: 'ZYX' })).toEqual({ x: 10, y: 20, z: 30, order: 'ZYX' });
    });

    it('euler3Ops lerps per axis and switches the order at the halfway point', () => {
        const from: Euler3 = { x: 0, y: 0, z: 0, order: 'XYZ' };
        const to: Euler3 = { x: 100, y: 200, z: 300, order: 'ZYX' };
        expect(euler3Ops.lerp(from, to, 0.25)).toEqual({ x: 25, y: 50, z: 75, order: 'XYZ' });
        expect(euler3Ops.lerp(from, to, 0.5)).toEqual({ x: 50, y: 100, z: 150, order: 'ZYX' });
    });

    it('quaternionOps.resolve is the identity function on the value', () => {
        const q = { x: 0.1, y: 0.2, z: 0.3, w: 0.9 };
        expect(quaternionOps.resolve(q)).toBe(q);
    });

    it('quaternionOps.lerp is slerp', () => {
        const a = quaternionFromEuler({ x: 0, y: 0, z: 0 });
        const b = quaternionFromEuler({ x: 0, y: 90, z: 0 });
        expectQuaternion(quaternionOps.lerp(a, b, 0.5), slerpQuaternion(a, b, 0.5));
        expectQuaternion(quaternionOps.lerp(a, b, 0.5), quaternionFromEuler({ x: 0, y: 45, z: 0 }));
    });
});

describe('slerpQuaternion and normalizeQuaternion', () => {
    it('falls back to a normalized linear blend for nearly parallel inputs', () => {
        const a = IDENTITY_QUATERNION;
        const b = quaternionFromEuler({ x: 0, y: 0.5, z: 0 });
        const mid = slerpQuaternion(a, b, 0.5);
        expect(Math.hypot(mid.x, mid.y, mid.z, mid.w)).toBeCloseTo(1, 9);
        expectQuaternion(mid, quaternionFromEuler({ x: 0, y: 0.25, z: 0 }));
    });

    it('returns identity for a zero quaternion and scales any other to unit length', () => {
        expect(normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 })).toEqual(IDENTITY_QUATERNION);
        expect(normalizeQuaternion({ x: 0, y: 0, z: 0, w: 5 })).toEqual({ x: 0, y: 0, z: 0, w: 1 });
        expect(normalizeQuaternion({ x: 3, y: 0, z: 4, w: 0 })).toEqual({ x: 0.6, y: 0, z: 0.8, w: 0 });
    });

    it('does not hand back the shared identity object, so a caller cannot corrupt it', () => {
        const zero = normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 });
        expect(zero).not.toBe(IDENTITY_QUATERNION);
    });
});

describe('optional vectors', () => {
    it('resolveVector3 treats missing components as 0', () => {
        expect(resolveVector3({ x: 1 } as never)).toEqual({ x: 1, y: 0, z: 0 });
        expect(resolveVector3([1] as never)).toEqual({ x: 1, y: 0, z: 0 });
    });

    it('resolveOptionalVector3 leaves an unset input unset', () => {
        expect(resolveOptionalVector3(undefined)).toBeUndefined();
        expect(resolveOptionalVector3(0)).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('lerpOptionalVector3 keeps the start when the target ends unset', () => {
        const from = { x: 1, y: 2, z: 3 };
        expect(lerpOptionalVector3(from, undefined, 0.5, 'origin')).toBe(from);
        expect(lerpOptionalVector3(undefined, undefined, 0.5, 'snap')).toBeUndefined();
    });

    it('lerpOptionalVector3 starts an unset value at the origin or holds it until the end', () => {
        const to = { x: 4, y: 0, z: 0 };
        expect(lerpOptionalVector3(undefined, to, 0.5, 'origin')).toEqual({ x: 2, y: 0, z: 0 });
        expect(lerpOptionalVector3(undefined, to, 0.5, 'snap')).toBeUndefined();
        expect(lerpOptionalVector3(undefined, to, 1, 'snap')).toBe(to);
    });
});
