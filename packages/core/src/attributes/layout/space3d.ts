import { lerpNumber } from "@/tween/lerp";
import type { Matrix2D, Projection3D } from "./matrix2d";
import type { Vector2 } from "./vector2";

/**
 * The maths of a 2.5D space: flat nodes placed in one 3D frame and seen through
 * a single orbiting camera, rather than each projecting through a perspective of
 * its own (see {@link import("./matrix2d").nodeProjectedMatrix}).
 *
 * Everything here works in the space root's canvas frame — x right, y **down**,
 * z toward the viewer, the frame `nodeProjectedMatrix` already tilts nodes in —
 * so a node's transform is the same rotation block with the perspective divide
 * lifted out and applied once, by the camera, to the whole scene.
 */

/** A point a camera is aimed at. `z` is depth, toward the viewer, as a node's `depth` is. */
export interface LookAt extends Vector2 {
    z?: number;
}

/** Lerp a {@link LookAt}, leaving `z` off when neither end has one so a flat camera stays two numbers. */
export function lerpLookAt(from: LookAt, to: LookAt, t: number): LookAt {
    const out: LookAt = { x: lerpNumber(from.x, to.x, t), y: lerpNumber(from.y, to.y, t) };
    if (from.z !== undefined || to.z !== undefined) out.z = lerpNumber(from.z ?? 0, to.z ?? 0, t);
    return out;
}

/**
 * A space root's camera for one frame.
 *
 * `orbit`/`elevation` mean what they mean on `Camera3D` (`render3d/camera.ts`,
 * `resolveCameraPlacement`): orbit 0 is head-on, a positive orbit moves the
 * camera toward +x, a positive elevation lifts it. `perspective` is the camera's
 * distance from `lookAt` at `dolly: 0`, CSS's convention, so the focus plane
 * draws 1:1; `0` is a parallel projection. `zoom` and `heading` apply after the
 * projection, which makes them lens zoom and roll exactly.
 */
/** @internal */
export interface SpaceCamera {
    perspective: number;
    orbit: number;
    elevation: number;
    dolly: number;
    /** Authored y-up, like every other scene point. */
    lookAt: LookAt;
    zoom: number;
    heading: number;
    /** The viewport centre in the root's canvas frame. */
    viewportX: number;
    viewportY: number;
}

/** Row-major 3×4 affine transform: `[r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]`. */
/** @internal */
export type Affine3 = readonly number[];

/** @internal */
export const IDENTITY_AFFINE3: Affine3 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** @internal `a · b` — applies `b` first, the same order as `matrix2d`'s `multiply`. */
export function multiplyAffine3(a: Affine3, b: Affine3): Affine3 {
    const out = new Array<number>(12);
    for (let r = 0; r < 3; r++) {
        const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2], a3 = a[r * 4 + 3];
        out[r * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8];
        out[r * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
        out[r * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
        out[r * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3;
    }
    return out;
}

/**
 * A node's transform in its parent's 3D frame — {@link import("./matrix2d").nodeProjectedMatrix}
 * without the perspective, which in a space belongs to the camera:
 *
 *   `T(cx + pivotX, cy + pivotY, depth) · Rx · Ry · Rz(rotation + rotationZ) · S(scale) · T(-pivot) · F(flip)`
 *
 * `p.perspective` is ignored. The scale is uniform in all three axes, so a
 * scaled group scales the depth its children sit at too.
 */
/** @internal */
export function nodeSpaceMatrix(
    cx: number, cy: number, rotation: number, scale: number, pivotX: number, pivotY: number,
    p: Projection3D,
): Affine3 {
    const rad = Math.PI / 180;
    const ca = Math.cos(p.rotationX * rad), sa = Math.sin(p.rotationX * rad);
    const cb = Math.cos(p.rotationY * rad), sb = Math.sin(p.rotationY * rad);
    const cz = (rotation + p.rotationZ) * rad;
    const cc = Math.cos(cz), sc = Math.sin(cz);

    const r00 = cb * cc * scale, r01 = -cb * sc * scale, r02 = sb * scale;
    const r10 = (sa * sb * cc + ca * sc) * scale, r11 = (ca * cc - sa * sb * sc) * scale, r12 = -sa * cb * scale;
    const r20 = (sa * sc - ca * sb * cc) * scale, r21 = (ca * sb * sc + sa * cc) * scale, r22 = ca * cb * scale;

    // Mirrors negate the two in-plane columns only, about the node's own centre —
    // the same in-place reflection `nodeProjectedMatrix` makes.
    const fx = p.flipHorizontal ? -1 : 1;
    const fy = p.flipVertical ? -1 : 1;
    return [
        r00 * fx, r01 * fy, r02, cx + pivotX - (r00 * pivotX + r01 * pivotY),
        r10 * fx, r11 * fy, r12, cy + pivotY - (r10 * pivotX + r11 * pivotY),
        r20 * fx, r21 * fy, r22, p.depth - (r20 * pivotX + r21 * pivotY),
    ];
}

/**
 * The camera's view of the root frame: `T(0, 0, dolly) · R(camera)ᵀ · T(-lookAt)`.
 *
 * Built from the camera's own axes rather than from a look-at basis, so there is
 * no pole to clamp: an elevation past 90° keeps turning rather than snapping to
 * an arbitrary roll.
 */
/** @internal */
export function spaceViewMatrix(cam: SpaceCamera): Affine3 {
    const rad = Math.PI / 180;
    const sa = Math.sin(cam.orbit * rad), ca = Math.cos(cam.orbit * rad);
    const se = Math.sin(cam.elevation * rad), ce = Math.cos(cam.elevation * rad);
    // Rows: the camera's right, screen-down and toward-camera axes.
    const r0 = ca, r1 = 0, r2 = -sa;
    const d0 = sa * se, d1 = ce, d2 = ca * se;
    const f0 = sa * ce, f1 = -se, f2 = ca * ce;
    const tx = cam.lookAt.x, ty = -cam.lookAt.y, tz = cam.lookAt.z ?? 0;
    return [
        r0, r1, r2, -(r0 * tx + r1 * ty + r2 * tz),
        d0, d1, d2, -(d0 * tx + d1 * ty + d2 * tz),
        f0, f1, f2, -(f0 * tx + f1 * ty + f2 * tz) + cam.dolly,
    ];
}

/**
 * Project a view-space transform onto the screen: the homography that maps a
 * node's local `(x, y, 1)` to the root's canvas, perspective divide and the
 * camera's zoom and roll included.
 *
 * At rest — no orbit, elevation, dolly or `lookAt.z`, and a node with no depth
 * or tilt — this is exactly `cameraMatrix · local`, which is what makes turning
 * a space on invisible until something moves in depth.
 */
/** @internal */
export function spaceScreenMatrix(cam: SpaceCamera, view: Affine3): Matrix2D {
    const invP = cam.perspective > 0 ? 1 / cam.perspective : 0;
    const wx = -view[8] * invP;
    const wy = -view[9] * invP;
    const w0 = 1 - view[11] * invP;

    const rad = (-cam.heading * Math.PI) / 180;
    const k = cam.zoom;
    const c00 = k * Math.cos(rad), c01 = -k * Math.sin(rad);
    const c10 = k * Math.sin(rad), c11 = k * Math.cos(rad);
    const vx = cam.viewportX, vy = cam.viewportY;

    const m: Matrix2D = {
        a: c00 * view[0] + c01 * view[4] + vx * wx,
        c: c00 * view[1] + c01 * view[5] + vx * wy,
        e: c00 * view[3] + c01 * view[7] + vx * w0,
        b: c10 * view[0] + c11 * view[4] + vy * wx,
        d: c10 * view[1] + c11 * view[5] + vy * wy,
        f: c10 * view[3] + c11 * view[7] + vy * w0,
    };
    // A parallel projection stays affine, so it keeps the six-number fast paths.
    if (invP !== 0) {
        m.g = wx;
        m.h = wy;
        m.i = w0;
    }
    return m;
}

/** A node's box in view space: what sorting, culling and the backface test read. */
/** @internal */
export interface SpacePlane {
    /** The four corners, `x, y, z` each, top-left clockwise. */
    corners: readonly number[];
    cx: number;
    cy: number;
    cz: number;
    /** Unit normal, pointing out of the node's front. */
    nx: number;
    ny: number;
    nz: number;
}

/**
 * `box` — the node's ink, centred and y-down in its local frame — through `view`.
 *
 * The normal is the transform's z column, which a mirror never touches: a flip
 * reflects the node without turning it around, so it cannot show its back.
 */
/** @internal */
export function spacePlane(view: Affine3, box: { x: number; y: number; width: number; height: number }): SpacePlane {
    const hw = box.width / 2, hh = box.height / 2;
    const us = [box.x - hw, box.x + hw, box.x + hw, box.x - hw];
    const vs = [box.y - hh, box.y - hh, box.y + hh, box.y + hh];
    const corners = new Array<number>(12);
    for (let i = 0; i < 4; i++) {
        const u = us[i], v = vs[i];
        corners[i * 3] = view[0] * u + view[1] * v + view[3];
        corners[i * 3 + 1] = view[4] * u + view[5] * v + view[7];
        corners[i * 3 + 2] = view[8] * u + view[9] * v + view[11];
    }
    const nl = Math.hypot(view[2], view[6], view[10]) || 1;
    return {
        corners,
        cx: view[0] * box.x + view[1] * box.y + view[3],
        cy: view[4] * box.x + view[5] * box.y + view[7],
        cz: view[8] * box.x + view[9] * box.y + view[11],
        nx: view[2] / nl,
        ny: view[6] / nl,
        nz: view[10] / nl,
    };
}

/**
 * Below this `w` a point is at or behind the camera. Not zero: a point just in
 * front of the lens projects so far out that float32 path maths loses it,
 * and at 1/100 the layer is already magnified a hundredfold — well past the edge
 * of any frame.
 */
const NEAR_W = 0.01;

/** Within this fraction of edge-on, a plane projects to a sliver narrower than a pixel. */
const EDGE_ON = 1e-3;

/**
 * How `plane` sits relative to the camera: `side` is positive when the camera
 * is in front of it, `edgeOn` when the camera lies (almost) in its plane.
 */
/** @internal */
export function cameraSide(cam: SpaceCamera, plane: SpacePlane): { side: number; edgeOn: boolean } {
    if (cam.perspective > 0) {
        const dx = -plane.cx, dy = -plane.cy, dz = cam.perspective - plane.cz;
        const side = plane.nx * dx + plane.ny * dy + plane.nz * dz;
        return { side, edgeOn: Math.abs(side) <= EDGE_ON * Math.hypot(dx, dy, dz) };
    }
    return { side: plane.nz, edgeOn: Math.abs(plane.nz) <= EDGE_ON };
}

/** How much of `plane` is in front of the camera. A parallel projection has no near plane. */
/** @internal */
export function nearCoverage(cam: SpaceCamera, plane: SpacePlane): "all" | "some" | "none" {
    if (cam.perspective <= 0) return "all";
    let inFront = 0;
    for (let i = 0; i < 4; i++) {
        if (1 - plane.corners[i * 3 + 2] / cam.perspective > NEAR_W) inFront++;
    }
    return inFront === 4 ? "all" : inFront === 0 ? "none" : "some";
}

/**
 * The part of `box` (local, y-down) that lies in front of the camera under the
 * homography `screen`, as a polygon in the same frame — or `null` when none of
 * it does. `margin` grows the box first, so a shadow or stroke spilling past the
 * node's ink is not cut along its edge.
 */
/** @internal */
export function nearCutPolygon(
    screen: Matrix2D,
    box: { x: number; y: number; width: number; height: number },
    margin: number,
): Vector2[] | null {
    const g = screen.g ?? 0, h = screen.h ?? 0, i = screen.i ?? 1;
    const hw = box.width / 2 + margin, hh = box.height / 2 + margin;
    const square: Vector2[] = [
        { x: box.x - hw, y: box.y - hh },
        { x: box.x + hw, y: box.y - hh },
        { x: box.x + hw, y: box.y + hh },
        { x: box.x - hw, y: box.y + hh },
    ];
    const w = (p: Vector2) => g * p.x + h * p.y + i - NEAR_W;
    const out: Vector2[] = [];
    for (let k = 0; k < square.length; k++) {
        const a = square[k], b = square[(k + 1) % square.length];
        const wa = w(a), wb = w(b);
        if (wa >= 0) out.push(a);
        if ((wa >= 0) !== (wb >= 0)) {
            const t = wa / (wa - wb);
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    return out.length >= 3 ? out : null;
}

/** Two points closer than this in view space (px) count as touching. */
const SIDE_EPS = 0.01;

/**
 * Which side of `a`'s plane `b` lies on, as seen from the camera:
 * `1` in front (toward the camera), `-1` behind, `0` straddling it or lying in
 * it. `camSide` is `a`'s {@link cameraSide}.
 */
function sideOf(a: SpacePlane, b: SpacePlane, camSide: number): number {
    let front = 0, back = 0;
    for (let i = 0; i < 4; i++) {
        const d = a.nx * (b.corners[i * 3] - a.cx) + a.ny * (b.corners[i * 3 + 1] - a.cy) + a.nz * (b.corners[i * 3 + 2] - a.cz);
        if (d > SIDE_EPS) front++;
        else if (d < -SIDE_EPS) back++;
    }
    if (front === 0 && back === 0) return 0;
    const facing = camSide > 0 ? 1 : -1;
    if (back === 0) return facing;
    if (front === 0) return -facing;
    return 0;
}

/** Squared distance from the camera: larger is farther. */
function farness(cam: SpaceCamera, p: SpacePlane): number {
    if (cam.perspective > 0) return p.cx * p.cx + p.cy * p.cy + (cam.perspective - p.cz) ** 2;
    return -p.cz;
}

/**
 * `-1` when `a` must paint before `b`, `1` after, `0` when either order is right
 * — coplanar siblings, which keep their authored order.
 *
 * A plane test first, since it is exact for anything that does not intersect:
 * whichever node lies wholly on the camera's side of the other's plane is in
 * front. Parallel layers — the whole of a parallax stack — always resolve here,
 * and so do coplanar ones, as a tie. Only planes that cut through each other fall
 * back to the distance of their centres, and no painter's order is right for
 * those anyway.
 */
function compareInSpace(cam: SpaceCamera, a: SpacePlane, b: SpacePlane): number {
    const ca = cameraSide(cam, a);
    if (!ca.edgeOn) {
        const s = sideOf(a, b, ca.side);
        if (s !== 0) return s > 0 ? -1 : 1;
        if (isCoplanar(a, b)) return 0;
    }
    const cb = cameraSide(cam, b);
    if (!cb.edgeOn) {
        const s = sideOf(b, a, cb.side);
        if (s !== 0) return s > 0 ? 1 : -1;
    }
    const fa = farness(cam, a), fb = farness(cam, b);
    return fa === fb ? 0 : fa > fb ? -1 : 1;
}

function isCoplanar(a: SpacePlane, b: SpacePlane): boolean {
    for (let i = 0; i < 4; i++) {
        const d = a.nx * (b.corners[i * 3] - a.cx) + a.ny * (b.corners[i * 3 + 1] - a.cy) + a.nz * (b.corners[i * 3 + 2] - a.cz);
        if (Math.abs(d) > SIDE_EPS) return false;
    }
    return true;
}

/** A stage's camera as its props state it — what a host reads off the root row. */
export interface SpaceCameraProps {
    perspective: number;
    orbit: number;
    elevation: number;
    dolly: number;
    lookAt: LookAt;
    zoom: number;
    heading: number;
}

/** A point in a space, y-up like every scene point, `z` toward the viewer. */
export interface SpacePoint {
    x: number;
    y: number;
    z: number;
}

function rootCamera(props: SpaceCameraProps): SpaceCamera {
    return { ...props, viewportX: 0, viewportY: 0 };
}

/**
 * The space's camera maths for a host drawing over the picture — a gizmo
 * aiming the camera, a guide marking where it looks — so it asks the renderer's
 * own arithmetic rather than keeping a copy that could drift from it. Points are
 * in viewport space: origin at the centre, y-up.
 */
export const space3dOps = {
    lerpLookAt,

    /** Where scene point `point` lands in the viewport through `camera`, or `null` behind the lens. */
    project(camera: SpaceCameraProps, point: LookAt): Vector2 | null {
        const cam = rootCamera(camera);
        const v = spaceViewMatrix(cam);
        const x = point.x, y = -point.y, z = point.z ?? 0;
        const vx = v[0] * x + v[1] * y + v[2] * z + v[3];
        const vy = v[4] * x + v[5] * y + v[6] * z + v[7];
        const vz = v[8] * x + v[9] * y + v[10] * z + v[11];
        const w = cam.perspective > 0 ? 1 - vz / cam.perspective : 1;
        if (w <= NEAR_W) return null;
        const rad = (-cam.heading * Math.PI) / 180;
        const px = (cam.zoom * vx) / w, py = (cam.zoom * vy) / w;
        return {
            x: Math.cos(rad) * px - Math.sin(rad) * py,
            y: -(Math.sin(rad) * px + Math.cos(rad) * py),
        };
    },

    /**
     * The displacement at the camera's focus — in the plane facing it through
     * `lookAt` — that moves the picture there by `vector`. The inverse of a pan:
     * a hand dragging the picture by `vector` moves `lookAt` by minus this.
     */
    focusVector(camera: SpaceCameraProps, vector: Vector2): SpacePoint {
        const cam = rootCamera(camera);
        const rad = (-cam.heading * Math.PI) / 180;
        const k = cam.zoom || 1;
        const cx = vector.x, cy = -vector.y;
        const px = (Math.cos(rad) * cx + Math.sin(rad) * cy) / k;
        const py = (-Math.sin(rad) * cx + Math.cos(rad) * cy) / k;
        // A focus pushed nearer by the dolly draws larger, so it moves less for the same drag.
        const w = cam.perspective > 0 ? 1 - cam.dolly / cam.perspective : 1;
        const v = spaceViewMatrix(cam);
        const ux = px * w, uy = py * w;
        // The view's first two rows are the camera's right and screen-down axes.
        return {
            x: ux * v[0] + uy * v[4],
            y: -(ux * v[1] + uy * v[5]),
            z: ux * v[2] + uy * v[6],
        };
    },
};

/** Past this many siblings the pairwise order costs more than it is worth, and the centres decide. */
const PAIRWISE_LIMIT = 96;

/**
 * The order to paint siblings in, far to near, as indices into `planes`.
 *
 * Pairwise {@link compareInSpace} relations become edges, and a stable
 * topological sort that always takes the lowest ready index keeps `layerOrder`
 * wherever the geometry has no opinion. A cycle — three planes each overlapping
 * the next, which no painter's order can draw — is broken at its farthest node.
 */
/** @internal */
export function spacePaintOrder(cam: SpaceCamera, planes: readonly SpacePlane[]): number[] {
    const n = planes.length;
    if (n > PAIRWISE_LIMIT) {
        return planes
            .map((_, i) => i)
            .sort((a, b) => farness(cam, planes[b]) - farness(cam, planes[a]) || a - b);
    }

    const after: number[][] = Array.from({ length: n }, () => []);
    const blockers = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const r = compareInSpace(cam, planes[i], planes[j]);
            if (r < 0) { after[i].push(j); blockers[j]++; }
            else if (r > 0) { after[j].push(i); blockers[i]++; }
        }
    }

    const order: number[] = [];
    const done = new Array<boolean>(n).fill(false);
    while (order.length < n) {
        let next = -1;
        for (let i = 0; i < n; i++) {
            if (!done[i] && blockers[i] === 0) { next = i; break; }
        }
        if (next === -1) {
            let far = -Infinity;
            for (let i = 0; i < n; i++) {
                if (done[i]) continue;
                const f = farness(cam, planes[i]);
                if (f > far) { far = f; next = i; }
            }
        }
        done[next] = true;
        order.push(next);
        for (const j of after[next]) blockers[j]--;
    }
    return order;
}
