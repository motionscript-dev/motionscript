import { lerpNumber } from "@/tween/lerp";
import type { AttributeOps } from "@/attributes/shared/operators";

/** A 3D point or offset: core's {@link Vector2} one dimension up, in the same plain-object idiom. */
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

/**
 * Loose forms accepted anywhere a {@link Vector3} is expected:
 *
 *  - an object — `{ x: 1, y: 2, z: 3 }`
 *  - a 3-tuple — `[1, 2, 3]`
 *  - a scalar, broadcast to all three axes — `0` means the origin, `2` means
 *    `{ x: 2, y: 2, z: 2 }` (handy for uniform scale and `lookAt: 0`)
 */
export type Vector3Input = Vector3 | readonly [number, number, number] | number;

const ZERO: Vector3 = { x: 0, y: 0, z: 0 };

export function resolveVector3(input: Vector3Input | undefined): Vector3 {
    if (input === undefined) return { ...ZERO };
    if (typeof input === "number") return { x: input, y: input, z: input };
    if (Array.isArray(input)) return { x: input[0] ?? 0, y: input[1] ?? 0, z: input[2] ?? 0 };
    const v = input as Vector3;
    return { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 };
}

/** Component-wise lerp (`t=0` is `from`, `t=1` is `to`). Pass as a prop's `tween` so 3D vectors animate (`property({ default, tween: lerpVector3 })`, or a `Types.vector3` entry); without one `to()` leaves the prop alone. */
export function lerpVector3(from: Vector3, to: Vector3, t: number): Vector3 {
    return {
        x: lerpNumber(from.x, to.x, t),
        y: lerpNumber(from.y, to.y, t),
        z: lerpNumber(from.z, to.z, t),
    };
}

/** The `Vector3` attribute's op set — a 3D position or scale. */
export const vector3Ops: AttributeOps<Vector3Input, Vector3> = {
    resolve: (value) => resolveVector3(value),
    lerp: lerpVector3,
};

/**
 * Map an optional {@link Vector3Input}: an unset prop stays unset (a thunk that
 * returns `undefined` included) instead of resolving to the origin, which would
 * turn "no aim" into "aim at the origin".
 */
export function resolveOptionalVector3(input: Vector3Input | undefined): Vector3 | undefined {
    return input === undefined ? undefined : resolveVector3(input);
}

/** Lerp for a vector prop that may be unset (a node's `lookAt`, a camera's or light's `target`). With no start value, `unset: "origin"` blends from the origin (the renderer's reading for `target`); `unset: "snap"` holds it unset and swaps at the end, the only honest reading for `lookAt` (unset is "do not aim"). A `to` that ends unset leaves the start in place. */
export function lerpOptionalVector3(
    from: Vector3 | undefined,
    to: Vector3 | undefined,
    t: number,
    unset: "origin" | "snap",
): Vector3 | undefined {
    if (to === undefined) return from;
    if (from !== undefined) return lerpVector3(from, to, t);
    if (unset === "origin") return lerpVector3(ZERO, to, t);
    return t >= 1 ? to : from;
}

/** The order Euler angles are applied in. Matches three's own naming. */
export type EulerOrder = "XYZ" | "YXZ" | "ZXY" | "ZYX" | "YZX" | "XZY";

/** An Euler rotation in **degrees** (matching 2D `rotation`); the renderer converts. */
export interface Euler3 extends Vector3 {
    order?: EulerOrder;
}

/** Component-wise lerp of two Euler rotations in degrees; `order` is discrete and snaps at the halfway point. Euler interpolation gimbals near the poles and takes the "wrong" path past 180°: for a tumble use a {@link Quaternion} prop and {@link slerpQuaternion}. */
export function lerpEuler3(from: Euler3, to: Euler3, t: number): Euler3 {
    return {
        x: lerpNumber(from.x, to.x, t),
        y: lerpNumber(from.y, to.y, t),
        z: lerpNumber(from.z, to.z, t),
        order: t < 0.5 ? from.order : to.order,
    };
}

/** The `Euler3` attribute's op set — a rotation in degrees, per axis. */
export const euler3Ops: AttributeOps<Vector3Input | Euler3, Euler3> = {
    resolve: (input) => {
        const v = resolveVector3(input as Vector3Input);
        const order = (input as Euler3)?.order;
        return order ? { ...v, order } : v;
    },
    lerp: lerpEuler3,
};

export interface Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
}

export const IDENTITY_QUATERNION: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** Shortest-arc spherical lerp, the correct quaternion tween (a component-wise lerp leaves the unit hypersphere, so rotation speed varies). Negates `to` when `dot < 0` so the rotation takes the short way; falls back to a normalized linear blend when nearly parallel and `sin(theta)` would underflow. */
export function slerpQuaternion(from: Quaternion, to: Quaternion, t: number): Quaternion {
    let { x, y, z, w } = to;
    let dot = from.x * x + from.y * y + from.z * z + from.w * w;

    // Both q and -q describe the same rotation; pick the nearer representative.
    if (dot < 0) {
        x = -x; y = -y; z = -z; w = -w;
        dot = -dot;
    }

    // Nearly parallel — slerp's sin(theta) denominator underflows, and a linear
    // blend is indistinguishable at this angle anyway.
    if (dot > 0.9995) {
        return normalizeQuaternion({
            x: lerpNumber(from.x, x, t),
            y: lerpNumber(from.y, y, t),
            z: lerpNumber(from.z, z, t),
            w: lerpNumber(from.w, w, t),
        });
    }

    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const a = Math.sin((1 - t) * theta) / sinTheta;
    const b = Math.sin(t * theta) / sinTheta;

    return {
        x: from.x * a + x * b,
        y: from.y * a + y * b,
        z: from.z * a + z * b,
        w: from.w * a + w * b,
    };
}

/** Scale a quaternion back to unit length. Returns identity for a zero quat. */
export function normalizeQuaternion(q: Quaternion): Quaternion {
    const length = Math.hypot(q.x, q.y, q.z, q.w);
    if (length === 0) return { ...IDENTITY_QUATERNION };
    return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

/** Convert an {@link Euler3} (degrees) to a {@link Quaternion}. */
export function quaternionFromEuler(euler: Euler3): Quaternion {
    const half = Math.PI / 360; // deg → rad, then halved for the half-angle form
    const cx = Math.cos(euler.x * half), sx = Math.sin(euler.x * half);
    const cy = Math.cos(euler.y * half), sy = Math.sin(euler.y * half);
    const cz = Math.cos(euler.z * half), sz = Math.sin(euler.z * half);

    switch (euler.order ?? "XYZ") {
        case "YXZ":
            return {
                x: sx * cy * cz + cx * sy * sz,
                y: cx * sy * cz - sx * cy * sz,
                z: cx * cy * sz - sx * sy * cz,
                w: cx * cy * cz + sx * sy * sz,
            };
        case "ZXY":
            return {
                x: sx * cy * cz - cx * sy * sz,
                y: cx * sy * cz + sx * cy * sz,
                z: cx * cy * sz + sx * sy * cz,
                w: cx * cy * cz - sx * sy * sz,
            };
        case "ZYX":
            return {
                x: sx * cy * cz - cx * sy * sz,
                y: cx * sy * cz + sx * cy * sz,
                z: cx * cy * sz - sx * sy * cz,
                w: cx * cy * cz + sx * sy * sz,
            };
        case "YZX":
            return {
                x: sx * cy * cz + cx * sy * sz,
                y: cx * sy * cz + sx * cy * sz,
                z: cx * cy * sz - sx * sy * cz,
                w: cx * cy * cz - sx * sy * sz,
            };
        case "XZY":
            return {
                x: sx * cy * cz - cx * sy * sz,
                y: cx * sy * cz - sx * cy * sz,
                z: cx * cy * sz + sx * sy * cz,
                w: cx * cy * cz + sx * sy * sz,
            };
        case "XYZ":
        default:
            return {
                x: sx * cy * cz + cx * sy * sz,
                y: cx * sy * cz - sx * cy * sz,
                z: cx * cy * sz + sx * sy * cz,
                w: cx * cy * cz - sx * sy * sz,
            };
    }
}

/** The `Quaternion` attribute's op set: resolve is the identity, lerp shortest-arc slerps. */
export const quaternionOps: AttributeOps<Quaternion, Quaternion> = {
    resolve: (value) => value,
    lerp: slerpQuaternion,
};
