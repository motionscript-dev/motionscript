import { Node } from "@/components/trees/node/node";
import { Node3D, parentSpaceOf } from "@/components/trees/three/node3d";
import type { Node2D } from "@/components/trees/2d/node2d";
import type { Vector2 } from "@/attributes/layout/vector2";
import { applyToPoint, invert, type Matrix2D } from "@/attributes/layout/matrix2d";
import { resolveCameraPlacement, type CameraData3D } from "@/render3d/camera";
import type { Scene3D, Scene3DOp } from "@/render3d/scene3d";
import type { Transform3D } from "@/render3d/transform";
import {
    geometryBounds3D, transformBox3, unionBox3, centeredBox3, corners3, type Box3,
} from "@/render3d/bounds3d";
import {
    applyMatrix4, identity4, invert4, lookAtRotation4, multiply4, orthographic4,
    perspective4, transformMatrix4, translation4, type Matrix4,
} from "@/render3d/matrix4";
import type { Vector3 } from "@/render3d/vector3";
import { nodePath } from "@/project/tree";
import type { NodeBox } from "./node-picking";

/**
 * Where a `Node3D`'s pixels landed: the 3D half of `node-picking.ts`.
 *
 * The answer is a 2D box: the screen-space AABB of the node's projected world-space AABB, in the `Canvas3D`'s
 * own plane. It composes with everything the 2D side does (the canvas's rotation, its ancestors', a camera
 * scope above it) by being mapped through the canvas's `renderMatrix` as {@link nodeBox} maps a corner.
 *
 * Bounds come from the recorded {@link Scene3D} (the seam render and the asset pass both build, which measures
 * a custom `renderSelf` for free); paths come from the tree, because a path is a child index and ops carry
 * none. The two meet on `Node3D.id`, which the scene records as the `key` on every `push`.
 *
 * Nothing here imports `node-picking.ts` at runtime: the canvas's box and CTM arrive as a {@link
 * Canvas3DFrame}, so the dependency runs one way (the `NodeBox` import is type-only).
 *
 * A box is not clipped to the viewport: a mesh drifted off the canvas reports where it went, though no pixels
 * are drawn. {@link pickIn} only consults this file for a point already inside the rect. Every entry point
 * records the scene afresh, so a host calling {@link collectBoxes} on every pointer move over many viewports
 * pays one scene build per viewport per move.
 */

/** @internal */
/** A 2D node over a 3D scene (a `Canvas3D`): its 3D children are picked through the scene it builds. */
export interface Viewport3D extends Node2D {
    _isViewport3D(): boolean;
    _scene3D(): Scene3D | null;
}

export function isViewport3D(node: unknown): node is Viewport3D {
    return typeof (node as Partial<Viewport3D> | null)?._isViewport3D === "function" && (node as Viewport3D)._isViewport3D();
}

export interface Canvas3DFrame {
    /**
     * Its folded `rotation`/`scale`/`opacity` carry to every 3D node inside it: a mesh has none of its own, and
     * cursor angles and pixels-per-unit are questions about the plane the box is drawn in.
     */
    box: NodeBox;
    matrix: Matrix2D;
}

/**
 * Ordered by depth, not draw order (the one divergence from {@link collectBoxes}): a 3D scene has no draw
 * order to speak of, so "topmost" means "nearest". Empty when the scene has no camera that resolves, the
 * canvas has no size, or nothing can be measured (see {@link geometryBounds3D}).
 */
/** @internal */
export function collectBoxes3D(canvas: Viewport3D, frame: Canvas3DFrame, path: string): NodeBox[] {
    const projection = canvas3DProjection(canvas);
    if (!projection) return [];

    const out: { box: NodeBox; depth: number }[] = [];
    for (const entry of nodes3DOf(canvas, path)) {
        const world = projection.boxes.get(entry.node.id);
        if (!world) continue;
        const projected = projectBox3(world, projection);
        if (!projected) continue;
        out.push({
            box: toNodeBox(entry.node, entry.path, projected.rect, frame),
            depth: projected.depth,
        });
    }
    /**
     * View space looks down -Z, so a nearer node has the larger (less negative) z: descending puts the front
     * first.
     */
    out.sort((a, b) => b.depth - a.depth);
    return out.map((entry) => entry.box);
}

/**
 * Where arbitrary points around one `Node3D` land on screen, for a gizmo. All points come back in the same
 * viewport space as {@link NodeBox}. A `null` entry is behind the camera (the per-point version of {@link
 * projectBox3}'s eye-plane guard).
 *
 * Not `@internal`, unlike {@link projectNode3D}: a host gets this back from
 * `projectNode3DAt`/`PlaybackController.projectNode3D`.
 */
export interface Node3DFrame {
    origin: Vector2 | null;
    /**
     * `parentPoints` transformed by the node's parent's world matrix then projected: the frame
     * `Node3DProps.position` is expressed in, so a move or scale handle belongs here and `{ ...position, x:
     * position.x + 1 }` projects to where nudging `x` by one unit lands.
     */
    parentPoints: (Vector2 | null)[];
    /**
     * `localPoints` transformed by the node's own world matrix then projected, for geometry tracking its current
     * orientation (a rotation ring).
     */
    localPoints: (Vector2 | null)[];
}

const ORIGIN_3D: Vector3 = { x: 0, y: 0, z: 0 };

/**
 * `null` when the canvas has no projection (see {@link canvas3DProjection}) or the path does not resolve.
 * `canvasPath` is the same root {@link collectBoxes3D} and {@link pickNode3D} are handed.
 */
/** @internal */
export function projectNode3D(
    canvas: Viewport3D,
    frame: Canvas3DFrame,
    canvasPath: string,
    targetPath: string,
    parentPoints: readonly Vector3[],
    localPoints: readonly Vector3[],
): Node3DFrame | null {
    const projection = canvas3DProjection(canvas);
    if (!projection) return null;

    const entry = nodes3DOf(canvas, canvasPath).find((e) => e.path === targetPath);
    if (!entry) return null;

    const own = projection.matrices.get(entry.node.id);
    const parent = projection.parentMatrices.get(entry.node.id);
    if (!own || !parent) return null;

    const project = (matrix: Matrix4, points: readonly Vector3[]): (Vector2 | null)[] =>
        points.map((point) => projectPoint3(matrix, point, projection, frame));

    // A parent with coordinates of its own places the node by them, so that is the frame its position is in.
    const space = parentSpaceOf(entry.node);
    const placed = space ? parentPoints.map((point) => space.toLocal(point.x, point.y, point.z)) : parentPoints;

    return {
        origin: projectPoint3(own, ORIGIN_3D, projection, frame),
        parentPoints: project(parent, placed),
        localPoints: project(own, localPoints),
    };
}

/**
 * `null` when it lands behind the camera. The single-point sibling of {@link projectBox3}: no edges to clip.
 */
function projectPoint3(
    matrix: Matrix4,
    point: Vector3,
    projection: Canvas3DProjection,
    frame: Canvas3DFrame,
): Vector2 | null {
    const world = applyMatrix4(matrix, point);
    const clip = applyMatrix4(projection.clip, { x: world.x, y: world.y, z: world.z });
    if (clip.w <= MIN_CLIP_W) return null;

    const ndcX = clip.x / clip.w;
    const ndcY = clip.y / clip.w;
    const rectX = projection.centerX + ndcX * (projection.width / 2);
    const rectY = projection.centerY + ndcY * (projection.height / 2);

    const p = applyToPoint(frame.matrix, { x: rectX, y: -rectY });
    return { x: p.x, y: -p.y };
}

/**
 * The box, not the mesh. `tolerance` is grab-slop in scene units, applied in the canvas's own plane so it
 * stays a constant on-screen distance.
 */
/** @internal */
export function pickNode3D(
    canvas: Viewport3D,
    frame: Canvas3DFrame,
    point: Vector2,
    tolerance: number,
    path: string,
): NodeBox | null {
    const projection = canvas3DProjection(canvas);
    if (!projection) return null;

    /**
     * Into the canvas's own plane, undoing everything above it in one step: the inverse `containsPoint` takes,
     * with the same y-flips.
     */
    const inverse = invert(frame.matrix);
    if (!inverse) return null;
    const mapped = applyToPoint(inverse, { x: point.x, y: -point.y });
    const local = { x: mapped.x, y: -mapped.y };

    let best: { node: Node3D; path: string; rect: Rect2D } | null = null;
    let bestDepth = -Infinity;
    for (const entry of nodes3DOf(canvas, path)) {
        const world = projection.boxes.get(entry.node.id);
        if (!world) continue;
        const projected = projectBox3(world, projection);
        if (!projected) continue;
        if (!rectContains(projected.rect, local, tolerance)) continue;
        if (projected.depth <= bestDepth) continue;
        bestDepth = projected.depth;
        best = { node: entry.node, path: entry.path, rect: projected.rect };
    }
    return best ? toNodeBox(best.node, best.path, best.rect, frame) : null;
}

interface Node3DEntry {
    node: Node3D;
    path: string;
}

/**
 * Indexed against {@link Node._allChildren} rather than `children`, so a mesh and a HUD label under one
 * viewport are numbered the way the author wrote them.
 */
function nodes3DOf(canvas: Viewport3D, path: string): Node3DEntry[] {
    const out: Node3DEntry[] = [];
    walk3D(canvas._allChildren, path, out);
    return out;
}

function walk3D(children: readonly Node[], parentPath: string, out: Node3DEntry[]): void {
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!(child instanceof Node3D)) continue;
        const path = nodePath(parentPath, i);
        out.push({ node: child, path });
        walk3D(child._allChildren, path, out);
    }
}

interface Canvas3DProjection {
    boxes: Map<string, Box3>;
    matrices: Map<string, Matrix4>;
    parentMatrices: Map<string, Matrix4>;
    clip: Matrix4;
    view: Matrix4;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

function canvas3DProjection(canvas: Viewport3D): Canvas3DProjection | null {
    const bounds = canvas._localBounds();
    if (!(bounds.width > 0) || !(bounds.height > 0)) return null;

    const scene = canvas._scene3D();
    if (!scene) return null;
    const walked = walkScene3D(scene);
    if (walked.boxes.size === 0) return null;

    const view = invert4(walked.camera);
    if (!view) return null;

    const aspect = bounds.width / bounds.height;
    return {
        boxes: walked.boxes,
        matrices: walked.matrices,
        parentMatrices: walked.parentMatrices,
        clip: multiply4(projectionMatrix(walked.descriptor, aspect), view),
        view,
        width: bounds.width,
        height: bounds.height,
        centerX: bounds.x,
        centerY: bounds.y,
    };
}

interface Scope3D {
    key: string | undefined;
    matrix: Matrix4;
    visible: boolean;
    box: Box3 | null;
}

interface WalkedScene3D {
    boxes: Map<string, Box3>;
    /** Captured at `push`, unlike `boxes`, which needs children merged in at `pop`. */
    matrices: Map<string, Matrix4>;
    parentMatrices: Map<string, Matrix4>;
    camera: Matrix4;
    descriptor: CameraData3D | null;
}

/**
 * A node's box is the union of everything it drew and its children drew, so a `Group3D` that draws nothing is
 * still selectable as what it contains. An invisible scope contributes nothing: `visible: false` is skipped by
 * the renderer, and letting it inflate its parent's box would put that box round empty space. The 2D walk
 * skips `opacity: 0` on the same grounds.
 */
function walkScene3D(scene: Scene3D): WalkedScene3D {
    const boxes = new Map<string, Box3>();
    const matrices = new Map<string, Matrix4>();
    const parentMatrices = new Map<string, Matrix4>();
    const root: Scope3D = { key: undefined, matrix: identity4(), visible: true, box: null };
    const stack: Scope3D[] = [root];
    let camera: Matrix4 | null = null;
    let descriptor: CameraData3D | null = null;

    const top = (): Scope3D => stack[stack.length - 1];

    for (const op of scene.ops()) {
        const scope = top();
        switch (op.kind) {
            case "push": {
                const matrix = scopeMatrix(scope.matrix, op.transform);
                if (op.transform?.key !== undefined) {
                    matrices.set(op.transform.key, matrix);
                    parentMatrices.set(op.transform.key, scope.matrix);
                }
                stack.push({
                    key: op.transform?.key,
                    matrix,
                    visible: scope.visible && op.transform?.visible !== false,
                    box: null,
                });
                break;
            }
            case "pop": {
                /**
                 * The root frame is never popped: `Node3D.render` brackets its own begin/end and `Scene3D.assertBalanced`
                 * catches a hand-built scene that does not. Guarding keeps a malformed op list from reading past the stack.
                 */
                if (stack.length === 1) break;
                const closed = stack.pop() as Scope3D;
                if (!closed.visible || !closed.box) break;
                if (closed.key !== undefined) boxes.set(closed.key, closed.box);
                const parent = top();
                parent.box = unionBox3(parent.box, closed.box);
                break;
            }
            case "camera": {
                descriptor = op.camera;
                camera = cameraMatrix4(op.camera, scope.matrix);
                break;
            }
            case "light":
                /** A light has no extent, so a node that is only a light gets no box and cannot be picked. */
                break;
            default: {
                if (!scope.visible) break;
                const drawn = drawableBox3(op, scope.matrix);
                if (drawn) scope.box = unionBox3(scope.box, drawn);
                break;
            }
        }
    }

    return {
        boxes,
        matrices,
        parentMatrices,
        camera: camera ?? DEFAULT_CAMERA_MATRIX,
        descriptor,
    };
}

function scopeMatrix(parent: Matrix4, transform: Transform3D | undefined): Matrix4 {
    return multiply4(parent, transformMatrix4(transform, parent));
}

function drawableBox3(op: Scene3DOp, parent: Matrix4): Box3 | null {
    if (op.kind === "model") return null; // its extent arrives with the file
    if (!("transform" in op)) return null;

    const matrix = scopeMatrix(parent, op.transform);

    if (op.kind === "sprite") {
        /**
         * Three's `Sprite` has no geometry to ask: the one place the extent is assumed rather than read (a
         * camera-facing unit quad scaled by its transform).
         */
        return transformBox3(centeredBox3(0.5, 0.5, 0), matrix);
    }

    if (!("geometry" in op)) return null;
    const local = geometryBounds3D(op.geometry);
    if (!local) return null;

    if (op.kind === "instances") {
        /**
         * Every instance is placed inside the op's own transform, so the union is taken in that space and mapped out
         * once.
         */
        let box: Box3 | null = null;
        for (const instance of op.instances) {
            box = unionBox3(box, transformBox3(local, transformMatrix4(instance, null)));
        }
        return box ? transformBox3(box, matrix) : null;
    }

    return transformBox3(local, matrix);
}

/**
 * `lookAt` takes the camera branch of three's `Object3D.lookAt` (-Z at the target, where every other node aims
 * +Z), resolved against the camera's world position so a camera in an animated rig points where the author
 * said. See {@link lookAtRotation4}.
 *
 * The polar placement (`target`/`orbit`/`elevation`/`distance`) comes from {@link resolveCameraPlacement}, the
 * same call the renderer makes: two derivations of "where is the camera" could disagree, and a gizmo drawn
 * against a camera nobody renders is worse than none.
 */
function cameraMatrix4(descriptor: CameraData3D, parent: Matrix4): Matrix4 {
    const placement = resolveCameraPlacement(descriptor);

    if (placement.lookAt === undefined) {
        return multiply4(parent, transformMatrix4({ ...descriptor, position: placement.position }, parent));
    }
    const placed = applyMatrix4(parent, placement.position);
    const origin: Vector3 = { x: placed.x, y: placed.y, z: placed.z };
    return multiply4(translation4(origin), lookAtRotation4(origin, placement.lookAt));
}

/**
 * Pulled back along +Z, aimed at the origin. Mirrors `applyCamera`'s fallback, which makes a bare `g.box()`
 * render, and so pickable.
 */
const DEFAULT_CAMERA_MATRIX: Matrix4 = multiply4(
    translation4({ x: 0, y: 0, z: 5 }),
    lookAtRotation4({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }),
);

const DEFAULT_FOV = 50;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 1000;

function projectionMatrix(descriptor: CameraData3D | null, aspect: number): Matrix4 {
    if (descriptor === null) {
        return perspective4(DEFAULT_FOV, aspect, DEFAULT_NEAR, DEFAULT_FAR, 1);
    }
    if (descriptor.type === "perspective") {
        return perspective4(
            descriptor.fov ?? DEFAULT_FOV,
            /**
             * Always the node's own aspect: overriding it stretched the render, so a gizmo could only be wrong by
             * agreeing with one.
             */
            aspect,
            descriptor.near ?? DEFAULT_NEAR,
            descriptor.far ?? DEFAULT_FAR,
            descriptor.zoom ?? 1,
        );
    }
    /**
     * `frustumHeight` sets the visible world height and the width follows the node's aspect. The same rule as
     * `applyCamera`, restated because that one lives in the renderer, which core cannot import.
     */
    const halfHeight = (descriptor.frustumHeight ?? 10) / 2;
    return orthographic4(
        -halfHeight * aspect,
        halfHeight * aspect,
        halfHeight,
        -halfHeight,
        descriptor.near ?? DEFAULT_NEAR,
        descriptor.far ?? DEFAULT_FAR,
        descriptor.zoom ?? 1,
    );
}

interface Rect2D {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

const BOX_EDGES: readonly (readonly [number, number])[] = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
];

/** A point at `w = 0` is on the plane through the eye and projects to infinity. */
const MIN_CLIP_W = 1e-4;

/**
 * How far outside the canvas a projected box may reach, as a multiple of the canvas's size. A box straddling
 * the eye plane genuinely extends to the horizon, which is a useless answer for an overlay (a rectangle a
 * million pixels wide). Clamping keeps it pointing the right way, and is only reached when the box is already
 * unusable as a target.
 */
const OFFSCREEN_LIMIT = 8;

/**
 * The world box projected into the canvas's plane, plus its view-space depth. Edges are clipped rather than
 * corners clamped: a corner behind the eye projects reflected through the origin, so bounding the raw eight
 * would put the box on the wrong side. Entirely-behind boxes keep no edges, which is how a node behind the
 * camera stops being selectable.
 */
function projectBox3(
    world: Box3,
    projection: Canvas3DProjection,
): { rect: Rect2D; depth: number } | null {
    const corners = corners3(world);
    const clip = corners.map((corner) => applyMatrix4(projection.clip, corner));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;

    const include = (x: number, y: number, w: number) => {
        const ndcX = x / w;
        const ndcY = y / w;
        if (ndcX < minX) minX = ndcX;
        if (ndcY < minY) minY = ndcY;
        if (ndcX > maxX) maxX = ndcX;
        if (ndcY > maxY) maxY = ndcY;
        any = true;
    };

    for (const [a, b] of BOX_EDGES) {
        const p = clip[a];
        const q = clip[b];
        const pIn = p.w > MIN_CLIP_W;
        const qIn = q.w > MIN_CLIP_W;
        if (!pIn && !qIn) continue;
        if (pIn) include(p.x, p.y, p.w);
        if (qIn) include(q.x, q.y, q.w);
        if (pIn === qIn) continue;
        // Exactly one end is in front: cut the edge where `w` reaches the plane.
        const t = (MIN_CLIP_W - p.w) / (q.w - p.w);
        include(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, MIN_CLIP_W);
    }

    if (!any) return null;

    const halfWidth = projection.width / 2;
    const halfHeight = projection.height / 2;
    const limitX = halfWidth * OFFSCREEN_LIMIT;
    const limitY = halfHeight * OFFSCREEN_LIMIT;

    const rect: Rect2D = {
        minX: clamp(projection.centerX + minX * halfWidth, projection.centerX - limitX, projection.centerX + limitX),
        maxX: clamp(projection.centerX + maxX * halfWidth, projection.centerX - limitX, projection.centerX + limitX),
        minY: clamp(projection.centerY + minY * halfHeight, projection.centerY - limitY, projection.centerY + limitY),
        maxY: clamp(projection.centerY + maxY * halfHeight, projection.centerY - limitY, projection.centerY + limitY),
    };

    /**
     * Depth is taken at the box centre in view space (camera looks down -Z, so nearer is larger). One point rather
     * than eight: this orders "which of two overlapping nodes did you mean".
     */
    const centre: Vector3 = {
        x: (world.min.x + world.max.x) / 2,
        y: (world.min.y + world.max.y) / 2,
        z: (world.min.z + world.max.z) / 2,
    };
    const viewed = applyMatrix4(projection.view, centre);

    return { rect, depth: viewed.z };
}

function clamp(value: number, low: number, high: number): number {
    return value < low ? low : value > high ? high : value;
}

function rectContains(rect: Rect2D, point: Vector2, slop: number): boolean {
    return point.x >= rect.minX - slop
        && point.x <= rect.maxX + slop
        && point.y >= rect.minY - slop
        && point.y <= rect.maxY + slop;
}

/**
 * The corner mapping is {@link worldAnchors}': y flipped in and back out, since the CTM is canvas y-down and
 * everything around it y-up. Done here rather than via `worldAnchors` so the rect keeps its own centre: it is
 * axis-aligned in the canvas's plane but not centred on its origin.
 *
 * `rotation`, `scale` and `opacity` are the canvas's: a mesh's own mean nothing in two dimensions, and a host
 * reads these for the plane the box was drawn in.
 */
function toNodeBox(node: Node3D, path: string, rect: Rect2D, frame: Canvas3DFrame): NodeBox {
    const at = (x: number, y: number): Vector2 => {
        const p = applyToPoint(frame.matrix, { x, y: -y });
        return { x: p.x, y: -p.y };
    };
    return {
        id: node.id,
        path,
        type: node.className,
        topLeft: at(rect.minX, rect.maxY),
        topRight: at(rect.maxX, rect.maxY),
        bottomRight: at(rect.maxX, rect.minY),
        bottomLeft: at(rect.minX, rect.minY),
        center: at((rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2),
        width: rect.maxX - rect.minX,
        height: rect.maxY - rect.minY,
        rotation: frame.box.rotation,
        scale: frame.box.scale,
        opacity: frame.box.opacity,
        /**
         * A locked Canvas3D is already unpickable above, so reaching here means the viewport is free; a mesh locks on
         * its own account.
         */
        locked: node.locked,
    };
}
