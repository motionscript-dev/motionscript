import { Vector2 } from "@/attributes/layout/vector2";

/**
 * A 2D transform stored as the members of a 3x3 matrix `| a c e | b d f | g h i |` (DOM column order), so matrices
 * compose in draw order: `parent.multiply(child)` is the world transform of `child`. Point mapping is
 * `x' = (a·x + c·y + e) / w`, `y' = (b·x + d·y + f) / w`, `w = g·x + h·y + i`.
 *
 * **The bottom row is optional; omitted means `[0 0 1]`**, an ordinary affine transform. A node tilted out of its
 * plane projects through a homography, which does not fit in six numbers; a single matrix type keeps the renderer
 * and the hit test from disagreeing about where a node is.
 */
/** @internal */
export interface Matrix2D {
    a: number; b: number; c: number; d: number; e: number; f: number;
    /** Perspective row, x term. Omitted on an affine transform (means `0`). */
    g?: number;
    /** Perspective row, y term. Omitted on an affine transform (means `0`). */
    h?: number;
    /** Perspective row, constant term. Omitted on an affine transform (means `1`). */
    i?: number;
}

/** @internal Whether `m` carries a perspective row — i.e. whether `w` is not always 1. */
export function isProjective(m: Matrix2D): boolean {
    return (m.g ?? 0) !== 0 || (m.h ?? 0) !== 0 || (m.i ?? 1) !== 1;
}

/** Guards the perspective divide: clamping a vanishing-line point (`w = 0`) to a tiny same-signed `w` sends it far off-screen instead of poisoning anchors, hit tests and layout with Infinity/NaN. */
const MIN_W = 1e-6;
function safeW(w: number): number {
    if (w > MIN_W || w < -MIN_W) return w;
    return w < 0 ? -MIN_W : MIN_W;
}

/** @internal The identity transform. */
export function identity(): Matrix2D {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** @internal Pure translation by (tx, ty). */
export function translation(tx: number, ty: number): Matrix2D {
    return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/** `m1 · m2`: applies `m2` first, then `m1`. Two affine matrices take the six-member path (every composition in a 3D-free scene); the 3x3 product runs only when a side carries a perspective row. */
/** @internal */
export function multiply(m1: Matrix2D, m2: Matrix2D): Matrix2D {
    if (isProjective(m1) || isProjective(m2)) return multiplyProjective(m1, m2);
    return {
        a: m1.a * m2.a + m1.c * m2.b,
        b: m1.b * m2.a + m1.d * m2.b,
        c: m1.a * m2.c + m1.c * m2.d,
        d: m1.b * m2.c + m1.d * m2.d,
        e: m1.a * m2.e + m1.c * m2.f + m1.e,
        f: m1.b * m2.e + m1.d * m2.f + m1.f,
    };
}

function multiplyProjective(m1: Matrix2D, m2: Matrix2D): Matrix2D {
    const g1 = m1.g ?? 0, h1 = m1.h ?? 0, i1 = m1.i ?? 1;
    const g2 = m2.g ?? 0, h2 = m2.h ?? 0, i2 = m2.i ?? 1;
    return {
        a: m1.a * m2.a + m1.c * m2.b + m1.e * g2,
        c: m1.a * m2.c + m1.c * m2.d + m1.e * h2,
        e: m1.a * m2.e + m1.c * m2.f + m1.e * i2,
        b: m1.b * m2.a + m1.d * m2.b + m1.f * g2,
        d: m1.b * m2.c + m1.d * m2.d + m1.f * h2,
        f: m1.b * m2.e + m1.d * m2.f + m1.f * i2,
        g: g1 * m2.a + h1 * m2.b + i1 * g2,
        h: g1 * m2.c + h1 * m2.d + i1 * h2,
        i: g1 * m2.e + h1 * m2.f + i1 * i2,
    };
}

/** @internal Map a point through the transform. */
export function applyToPoint(m: Matrix2D, p: Vector2): Vector2 {
    const x = m.a * p.x + m.c * p.y + m.e;
    const y = m.b * p.x + m.d * p.y + m.f;
    if (!isProjective(m)) return { x, y };
    const w = safeW((m.g ?? 0) * p.x + (m.h ?? 0) * p.y + (m.i ?? 1));
    return { x: x / w, y: y / w };
}

/** The inverse, or `null` when `m` is singular (zero scale). Maps a viewport point back into a node's local space for hit testing. */
/** @internal */
export function invert(m: Matrix2D): Matrix2D | null {
    if (isProjective(m)) return invertProjective(m);
    const det = m.a * m.d - m.b * m.c;
    if (det === 0 || !Number.isFinite(det)) return null;
    const inv = 1 / det;
    return {
        a: m.d * inv,
        b: -m.b * inv,
        c: -m.c * inv,
        d: m.a * inv,
        e: (m.c * m.f - m.d * m.e) * inv,
        f: (m.b * m.e - m.a * m.f) * inv,
    };
}

/** Inverse of a homography (adjugate over determinant); still a homography, so picking keeps working with {@link applyToPoint} on a tilted node. */
function invertProjective(m: Matrix2D): Matrix2D | null {
    const { a, b, c, d, e, f } = m;
    const g = m.g ?? 0, h = m.h ?? 0, i = m.i ?? 1;
    // Cofactors of the 3×3 | a c e | / | b d f | / | g h i |.
    const A = d * i - f * h;
    const C = f * g - b * i;
    const E = b * h - d * g;
    const det = a * A + c * C + e * E;
    if (det === 0 || !Number.isFinite(det)) return null;
    const inv = 1 / det;
    return {
        a: A * inv,
        c: (e * h - c * i) * inv,
        e: (c * f - e * d) * inv,
        b: C * inv,
        d: (a * i - e * g) * inv,
        f: (e * b - a * f) * inv,
        g: E * inv,
        h: (c * g - a * h) * inv,
        i: (a * d - c * b) * inv,
    };
}

/**
 * The viewport transform a camera scope pushes, in canvas (y-down) space; a transcription of `RenderContext2D.beginCamera`:
 * `translate(vx, vy) · rotate(-heading) · scale(zoom) · translate(-lookAt.x, +lookAt.y)`. `lookAt` is y-up, hence the
 * sign flip; `vx`/`vy` are the viewport centre. Keep in step with {@link nodeLocalMatrix} and the renderer.
 */
/** @internal */
export function cameraMatrix(
    vx: number, vy: number, lookAt: Vector2, zoom: number, heading: number,
): Matrix2D {
    const rad = (-heading * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // rotate(-heading) · scale(zoom): clockwise canvas convention, as in nodeLocalMatrix.
    const a = zoom * cos;
    const b = zoom * sin;
    const c = zoom * -sin;
    const d = zoom * cos;
    // Fold the trailing translate(-lookAt.x, +lookAt.y) into e/f.
    const tx = -lookAt.x;
    const ty = lookAt.y;
    return { a, b, c, d, e: vx + a * tx + c * ty, f: vy + b * tx + d * ty };
}

/**
 * Local transform for a node, matching the renderer's `RenderContext2D.transform` exactly (canvas y-down):
 * `T(cx + pivotX, cy + pivotY) · R(deg) · S(scale) · T(-pivotX, -pivotY)`. `rotation` is degrees clockwise;
 * `cx`/`cy` are the node's layout-cell origin; the pivot offsets are in pixels.
 */
/** @internal */
export function nodeLocalMatrix(
    cx: number, cy: number, rotation: number, scale: number, pivotX: number, pivotY: number,
): Matrix2D {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // R(deg) · S(scale): clockwise rotation in canvas (y-down) is
    // | cos -sin | · | s 0 | = | s·cos -s·sin |
    // | sin  cos |   | 0 s |   | s·sin  s·cos |
    const a = scale * cos;
    const b = scale * sin;
    const c = scale * -sin;
    const d = scale * cos;
    // Fold the pivot translations into e/f:
    // T(cx+pivotX, cy+pivotY) · (RS) · T(-pivotX, -pivotY)
    return {
        a, b, c, d,
        e: cx + pivotX - (a * pivotX + c * pivotY),
        f: cy + pivotY - (b * pivotX + d * pivotY),
    };
}

/** The out-of-plane half of a node's transform: mirrors, the two extra rotation axes, the push along z and the perspective divide. See {@link nodeProjectedMatrix}. */
/** @internal */
export interface Projection3D {
    /** Tilt about the horizontal axis, degrees. Positive tips the top away. */
    rotationX: number;
    /** Tilt about the vertical axis, degrees. Positive swings the right edge away. */
    rotationY: number;
    /**
     * In-plane rotation of the 3D block, degrees clockwise (the Z axis of `Rx · Ry · Rz`). Separate from the node's
     * `rotation`: that is the node's **shape** (box, outline and handles turn with it), this is paint. They add, but
     * editing one never moves the other.
     */
    rotationZ: number;
    /** Push along the view axis in px, applied after the rotations. Inert without `perspective`. */
    depth: number;
    /** Viewer distance in px. `0` is no perspective at all — a parallel projection. */
    perspective: number;
    /** Mirror across the node's vertical centre line. */
    flipHorizontal: boolean;
    /** Mirror across the node's horizontal centre line. */
    flipVertical: boolean;
}

/** @internal Every field of a {@link Projection3D} at rest — the plain 2D node. */
export const NO_PROJECTION_3D: Projection3D = {
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    depth: 0,
    perspective: 0,
    flipHorizontal: false,
    flipVertical: false,
};

/** Whether `p` asks for anything {@link nodeLocalMatrix} cannot express; the gate in front of every projective path, so 3D-free scenes keep the affine matrix and `multiply`. */
/** @internal */
export function hasProjection3D(p: Projection3D): boolean {
    return (
        p.rotationX !== 0 ||
        p.rotationY !== 0 ||
        p.rotationZ !== 0 ||
        p.flipHorizontal ||
        p.flipVertical ||
        (p.perspective !== 0 && p.depth !== 0)
    );
}

/**
 * Whether a plane has turned its back on the viewer (behind `backfaceVisible`). Read off the tilt alone: the normal's
 * z is `cos(rotationX)·cos(rotationY)`; in-plane rotation and, deliberately, a *mirror* don't change it. CSS derives
 * it from the whole matrix, so `scaleX(-1)` hides the element, a surprising way to lose a node you only flipped.
 */
/** @internal */
export function facesAway(rotationX: number, rotationY: number): boolean {
    const rad = Math.PI / 180;
    return Math.cos(rotationX * rad) * Math.cos(rotationY * rad) < 0;
}

/**
 * A node's local transform with the out-of-plane half folded in; reduces exactly to {@link nodeLocalMatrix} when
 * {@link hasProjection3D} is false. Composition, innermost first:
 *
 *   `T(pivot) · P(perspective) · Tz(depth) · Rx · Ry · Rz(rotationZ + rotation) · S(scale) · T(-pivot) · F(flip)`
 *
 * The mirrors reflect about the node's own centre, not the pivot, so flipping cannot move the node. The Z angle is
 * the sum of `rotation` (shape) and {@link Projection3D.rotationZ} (paint), which stay two numbers (see
 * `Node2D._localMatrix`). Content is planar (`z = 0`), so everything collapses to a 3x3 homography over `(x, y, 1)`;
 * the projected z survives only as the perspective row. Parameters as {@link nodeLocalMatrix}, `p` the out-of-plane fields.
 */
/** @internal */
export function nodeProjectedMatrix(
    cx: number, cy: number, rotation: number, scale: number, pivotX: number, pivotY: number,
    p: Projection3D,
): Matrix2D {
    if (!hasProjection3D(p)) {
        return nodeLocalMatrix(cx, cy, rotation, scale, pivotX, pivotY);
    }
    const rad = Math.PI / 180;
    const ca = Math.cos(p.rotationX * rad), sa = Math.sin(p.rotationX * rad);
    const cb = Math.cos(p.rotationY * rad), sb = Math.sin(p.rotationY * rad);
    // The two in-plane rotations compose into one angle — see the note above.
    const cz = (rotation + p.rotationZ) * rad;
    const cc = Math.cos(cz), sc = Math.sin(cz);

    // The two columns of Rx·Ry·Rz that a z = 0 point can reach, scaled.
    const A = cb * cc * scale;
    const C = -cb * sc * scale;
    const B = (sa * sb * cc + ca * sc) * scale;
    const D = (ca * cc - sa * sb * sc) * scale;
    // The row that would have been the projected z, had we kept one.
    const G = (sa * sc - ca * sb * cc) * scale;
    const H = (ca * sb * sc + sa * cc) * scale;

    // Perspective: a point at depth z lands at x/w with w = 1 - z/perspective.
    // No perspective means a parallel projection — z is simply dropped, w stays
    // 1, and the result is affine (which is also why `depth` alone does nothing).
    const invP = p.perspective !== 0 ? 1 / p.perspective : 0;
    const g = -G * invP;
    const h = -H * invP;
    // The z the pivot itself sits at: -(G·pivotX + H·pivotY) is what the shift to
    // pivot-relative coordinates leaves in the z row, and `depth` is the push
    // along it, applied after the tilt (so it moves the whole tilted plane).
    const i = 1 - (p.depth - (G * pivotX + H * pivotY)) * invP;

    // Numerators about the pivot, then the trailing translate folded in. A
    // translate composes onto a homography as `+ t·w`, hence the g/h/i terms.
    const tx = cx + pivotX;
    const ty = cy + pivotY;

        // The mirrors, applied innermost and about the node's own centre (a final column negation, `M · diag(fx, fy, 1)`).
        // Not about the pivot like everything else: composing with the pivot, as CSS's `scaleX(-1)` does, makes a node
        // hinged off-centre swing when flipped. The frame is already centred, so a column scale leaves `e`/`f`/`i`
        // untouched and "a flip cannot move the node" falls out of the arithmetic.
    const fx = p.flipHorizontal ? -1 : 1;
    const fy = p.flipVertical ? -1 : 1;
    return {
        a: (A + tx * g) * fx,
        c: (C + tx * h) * fy,
        e: -(A * pivotX + C * pivotY) + tx * i,
        b: (B + ty * g) * fx,
        d: (D + ty * h) * fy,
        f: -(B * pivotX + D * pivotY) + ty * i,
        g: g * fx,
        h: h * fy,
        i,
    };
}
