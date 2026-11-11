import { quaternionFromEuler, resolveVector3, type Euler3, type Quaternion, type Vector3, type Vector3Input } from "./vector3";
import type { Transform3D } from "./transform";

/**
 * 4×4 matrix maths in **column-major order**, three's layout, so a matrix built here and one read off a
 * `THREE.Object3D` are the same sixteen numbers in the same slots.
 *
 * ```
 * | m0 m4 m8  m12 |
 * | m1 m5 m9  m13 |
 * | m2 m6 m10 m14 |
 * | m3 m7 m11 m15 |
 * ```
 *
 * Exists for {@link projectNode3D}, the walk that says where a 3D node's pixels landed, and holds only the maths
 * that walk needs. Each function mirrors a specific three behaviour (`Object3D.lookAt`'s two orientations,
 * `PerspectiveCamera.updateProjectionMatrix`'s zoom, an `OrthographicCamera`'s frustum from `frustumHeight`), since
 * a selection box a few pixels off the render is worse than none. Nothing here imports a renderer, so `three`
 * stays inside `@motionscript/browser`.
 */

/** A 4×4 matrix as sixteen numbers, column-major. See the module note. */
/** @internal */
export type Matrix4 = readonly number[];

/** A homogeneous point — what {@link applyMatrix4} returns before the divide. */
/** @internal */
export interface Vector4 extends Vector3 {
    w: number;
}

/** @internal The identity matrix. */
export function identity4(): Matrix4 {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** `a · b`: applies `b` first, then `a`. Composing a parent with a child gives the child's world transform, the convention of {@link import("@/attributes/layout/matrix2d").multiply} one dimension down. */
/** @internal */
export function multiply4(a: Matrix4, b: Matrix4): Matrix4 {
    const out = new Array<number>(16);
    for (let col = 0; col < 4; col++) {
        const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
        out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
}

/** The inverse, or `null` when `m` is singular (a zero scale on any axis); a camera with no inverse has no view, so the caller draws no boxes rather than dividing into `NaN`. */
/** @internal */
export function invert4(m: Matrix4): Matrix4 | null {
    const [
        n11, n21, n31, n41,
        n12, n22, n32, n42,
        n13, n23, n33, n43,
        n14, n24, n34, n44,
    ] = m;

    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const determinant = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (determinant === 0) return null;
    const d = 1 / determinant;

    return [
        t11 * d,
        (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
        (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
        (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,

        t12 * d,
        (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
        (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
        (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,

        t13 * d,
        (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
        (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
        (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,

        t14 * d,
        (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
        (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
        (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d,
    ];
}

/** @internal Map a point through `m`, keeping `w` — the caller does the divide. */
export function applyMatrix4(m: Matrix4, p: Vector3): Vector4 {
    const { x, y, z } = p;
    return {
        x: m[0] * x + m[4] * y + m[8] * z + m[12],
        y: m[1] * x + m[5] * y + m[9] * z + m[13],
        z: m[2] * x + m[6] * y + m[10] * z + m[14],
        w: m[3] * x + m[7] * y + m[11] * z + m[15],
    };
}

/** @internal Translation, rotation and scale composed into one matrix. */
export function compose4(position: Vector3, rotation: Quaternion, scale: Vector3): Matrix4 {
    const { x, y, z, w } = rotation;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    return [
        (1 - (yy + zz)) * scale.x, (xy + wz) * scale.x, (xz - wy) * scale.x, 0,
        (xy - wz) * scale.y, (1 - (xx + zz)) * scale.y, (yz + wx) * scale.y, 0,
        (xz + wy) * scale.z, (yz - wx) * scale.z, (1 - (xx + yy)) * scale.z, 0,
        position.x, position.y, position.z, 1,
    ];
}

/** The rotation aiming `eye`'s **−Z** at `target`, as three's `Matrix4.lookAt(eye, target, up)`. Callers reproduce `Object3D.lookAt`'s two cases by argument order: a camera or light aims −Z and passes `(position, target)`; everything else aims **+Z**, i.e. `(target, position)` (three's asymmetry; see `applyTransform` in the renderer). A degenerate pair (eye on target, up parallel to the view) has no orientation; three nudges `z` by `1e-4` and so does this, so they agree rather than one producing `NaN`. */
/** @internal */
export function lookAtRotation4(eye: Vector3, target: Vector3, up: Vector3 = UP): Matrix4 {
    let zx = eye.x - target.x, zy = eye.y - target.y, zz = eye.z - target.z;
    let length = Math.hypot(zx, zy, zz);
    if (length === 0) {
        zz = 1;
        length = 1;
    }
    zx /= length; zy /= length; zz /= length;

    let xx = up.y * zz - up.z * zy;
    let xy = up.z * zx - up.x * zz;
    let xz = up.x * zy - up.y * zx;
    let xLength = Math.hypot(xx, xy, xz);
    if (xLength === 0) {
        // Up is parallel to the view direction: three's own nudge, so both pick the same arbitrary roll.
        if (Math.abs(up.z) === 1) zx += 1e-4;
        else zz += 1e-4;
        length = Math.hypot(zx, zy, zz);
        zx /= length; zy /= length; zz /= length;
        xx = up.y * zz - up.z * zy;
        xy = up.z * zx - up.x * zz;
        xz = up.x * zy - up.y * zx;
        xLength = Math.hypot(xx, xy, xz);
    }
    xx /= xLength; xy /= xLength; xz /= xLength;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return [xx, xy, xz, 0, yx, yy, yz, 0, zx, zy, zz, 0, 0, 0, 0, 1];
}

/** three's default up vector, which nothing in the descriptors overrides yet. */
const UP: Vector3 = { x: 0, y: 1, z: 0 };

/** A {@link Transform3D} as a matrix in the parent's space. Precedence is the renderer's, `lookAt` > `quaternion` > `rotation` (each a complete orientation statement). `lookAt` names a world-space point, so it is resolved against `parentWorld` (as `Object3D.lookAt`): a node in a rotated group undoes that rotation. Pass `null` at the scene root. */
/** @internal */
export function transformMatrix4(transform: Transform3D | undefined, parentWorld: Matrix4 | null): Matrix4 {
    if (!transform) return identity4();

    const position = resolveVector3(transform.position);
    const scale = resolveVector3(transform.scale === undefined ? 1 : transform.scale);

    if (transform.lookAt !== undefined) {
        const target = resolveVector3(transform.lookAt);
        // `lookAt` is measured from the node's world position, not its local origin.
        const world = parentWorld
            ? applyMatrix4(parentWorld, position)
            : { ...position, w: 1 };
        const origin = { x: world.x, y: world.y, z: world.z };
        // +Z at the target: the non-camera branch of `Object3D.lookAt` (cameras go through `cameraMatrix4`).
        let rotation = lookAtRotation4(target, origin);
        if (parentWorld) {
            const inverseParent = invert4(rotationOf4(parentWorld));
            if (inverseParent) rotation = multiply4(inverseParent, rotation);
        }
        // T · R · S, the order {@link compose4} produces; spelled out because the rotation arrived as a matrix.
        return multiply4(multiply4(translation4(position), rotation), scale4(scale));
    }

    const quaternion = transform.quaternion ?? quaternionFromEuler(eulerOf(transform.rotation));
    return compose4(position, quaternion, scale);
}

/** A `Vector3Input | Euler3` as an {@link Euler3}, defaulting to no rotation. */
function eulerOf(rotation: Vector3Input | Euler3 | undefined): Euler3 {
    const angles = resolveVector3(rotation as Vector3Input | undefined);
    return { ...angles, order: (rotation as Euler3 | undefined)?.order };
}

/** @internal Pure translation. */
export function translation4(position: Vector3): Matrix4 {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, position.x, position.y, position.z, 1];
}

/** Pure per-axis scale. */
function scale4(scale: Vector3): Matrix4 {
    return [scale.x, 0, 0, 0, 0, scale.y, 0, 0, 0, 0, scale.z, 0, 0, 0, 0, 1];
}

/** `m`'s rotation with translation and scale divided out (three's `Matrix4.extractRotation`), used to undo a parent's orientation when resolving a `lookAt`; a zero-length basis vector leaves that column as identity. */
/** @internal */
export function rotationOf4(m: Matrix4): Matrix4 {
    const sx = Math.hypot(m[0], m[1], m[2]) || 1;
    const sy = Math.hypot(m[4], m[5], m[6]) || 1;
    const sz = Math.hypot(m[8], m[9], m[10]) || 1;
    return [
        m[0] / sx, m[1] / sx, m[2] / sx, 0,
        m[4] / sy, m[5] / sy, m[6] / sy, 0,
        m[8] / sz, m[9] / sz, m[10] / sz, 0,
        0, 0, 0, 1,
    ];
}

/** A perspective projection matching `PerspectiveCamera.updateProjectionMatrix`, including `zoom`, which three applies by narrowing the frustum rather than scaling the result. */
/** @internal */
export function perspective4(fov: number, aspect: number, near: number, far: number, zoom: number): Matrix4 {
    const top = near * Math.tan((fov * Math.PI) / 360) / zoom;
    const height = 2 * top;
    const width = aspect * height;
    const left = -0.5 * width;
    return frustum4(left, left + width, top, top - height, near, far);
}

/** three's `Matrix4.makePerspective`, with its reversed-`bottom` convention. */
function frustum4(left: number, right: number, top: number, bottom: number, near: number, far: number): Matrix4 {
    const x = (2 * near) / (right - left);
    const y = (2 * near) / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    const c = -(far + near) / (far - near);
    const d = (-2 * far * near) / (far - near);
    return [x, 0, 0, 0, 0, y, 0, 0, a, b, c, -1, 0, 0, d, 0];
}

/** An orthographic projection matching `OrthographicCamera.updateProjectionMatrix`: `zoom` widens the frustum about its centre rather than scaling the result. */
/** @internal */
export function orthographic4(left: number, right: number, top: number, bottom: number, near: number, far: number, zoom: number): Matrix4 {
    const dx = (right - left) / (2 * zoom);
    const dy = (top - bottom) / (2 * zoom);
    const cx = (right + left) / 2;
    const cy = (top + bottom) / 2;

    const l = cx - dx, r = cx + dx, t = cy + dy, b = cy - dy;
    const w = 1 / (r - l);
    const h = 1 / (t - b);
    const p = 1 / (far - near);
    return [
        2 * w, 0, 0, 0,
        0, 2 * h, 0, 0,
        0, 0, -2 * p, 0,
        -(r + l) * w, -(t + b) * h, -(far + near) * p, 1,
    ];
}
