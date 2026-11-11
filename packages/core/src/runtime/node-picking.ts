import { Node } from "@/components/trees/node/node";
import { Node2D, type NodeHandle } from "@/components/trees/2d/node2d";
import { Vector2 } from "@/attributes/layout/vector2";
import { Matrix2D, multiply, invert, applyToPoint, cameraMatrix, translation, isProjective } from "@/attributes/layout/matrix2d";
import { worldAnchors } from "@/components/trees/2d/node-transform";
import { spaceChildFrame, spaceChildOrder, spaceFrameForChildren, spaceFrameOf, spaceRootFrame } from "@/components/trees/2d/node-space";
import { multiplyAffine3, spaceScreenMatrix } from "@/attributes/layout/space3d";
import { nodePath } from "@/project/tree";
import { collectBoxes3D, isViewport3D, pickNode3D, projectNode3D, type Canvas3DFrame, type Node3DFrame, type Viewport3D } from "./node-picking3d";
import type { Vector3 } from "@/render3d/vector3";

/**
 * Pure geometry for editor-style direct manipulation, with no controller state so it runs against hand-built
 * trees. Everything is in viewport space: origin at the viewport centre, y-up, units = viewport pixels. That
 * is `Node2D.global`'s space plus the camera (see {@link renderMatrix}).
 */

/**
 * Unlike {@link Node2D.global} this folds in any active camera scope, so it describes where the pixels
 * actually landed, for a selection overlay.
 */
export interface NodeBox {
    /** Changes on every rebuild; key across rebuilds by {@link path}. */
    id: string;
    /** Structural path from the scene root (`""` is the root); stable across rebuilds. */
    path: string;
    type: string;
    /** Rotated/scaled, not axis-aligned. */
    topLeft: Vector2;
    topRight: Vector2;
    bottomRight: Vector2;
    bottomLeft: Vector2;
    center: Vector2;
    /**
     * The node's layout size, or the ink's own extent where the two differ (see {@link Node2D._localBounds}; a
     * boolean group reports its children's ink).
     */
    width: number;
    height: number;
    /** Degrees clockwise, camera included. */
    rotation: number;
    scale: number;
    /** `0` means the node is present but invisible. */
    opacity: number;
    /**
     * The editor's padlock, see {@link NodeEditorState.locked}. A locked node is never returned by {@link
     * pickNode}; it appears in {@link collectBoxes} so a host can still outline one selected from its layer tree.
     */
    locked: boolean;
}

/**
 * The renderer's CTM at `node`: every ancestor's local matrix from the root down, with a camera scope wherever
 * an ancestor pushes one ({@link Node2D._cameraScope}). A node inside a 2.5D space is placed by its frame
 * instead (the projection from its plane to the space root's, built by `node-space.ts` as the renderer does),
 * so it is a homography and `nodeBox` reports the projected corners.
 *
 * Mirrors the render walk exactly, including the camera's `translate(rect.x, -rect.y)`: if a box disagrees
 * with the pixels, the divergence is here. Shared with `text-geometry.ts` so a caret and the box around its
 * node come from one walk.
 */
/** @internal */
export function renderMatrix(node: Node2D): Matrix2D {
    const frame = spaceFrameOf(node);
    if (frame) return multiply(renderMatrix(frame.root), frame.screen);
    const parent = node.parent;
    return parent ? multiply(childrenMatrix(parent), node._localMatrix()) : node._localMatrix();
}

/**
 * Its render matrix, then whatever camera it opens. For a space root that is the camera over its own plane;
 * inside a space it is the parent's own frame, since a child's place is measured in its parent's plane.
 */
function childrenMatrix(parent: Node2D): Matrix2D {
    const m = renderMatrix(parent);
    const camera = parent._spaceCamera();
    if (camera) return multiply(m, spaceRootFrame(parent, camera).screen);
    const cam = parent._cameraScope();
    if (!cam) return m;
    const r = parent.layoutBounds;
    return multiply(m, cameraMatrix(r.x, -r.y, cam.lookAt, cam.zoom, cam.heading));
}

/**
 * Where `point` lands on the plane the node at `path` moves in when its `x`/`y` change, in its parent's frame:
 * centred on the parent (on its slot for a node a parent places, see `ChildPlacement`), y-up, through any
 * camera in between and pushed out to the node's own `depth` in a space. `null` when the path names no 2D node
 * below the root, or the plane cannot be reached (edge-on, or the point is behind the camera).
 *
 * Two answers differ by exactly the `x`/`y` change that carries the node from one point to the other, which a
 * move handle needs once a node can sit in depth. Under a parent with coordinates of its own
 * (`Node2D._planeOf`) the answer is in them.
 */
export function parentPlanePointAt(root: Node2D, path: string, point: Vector2): Vector2 | null {
    if (path === "") return null;
    const node = nodeAt(root, path);
    const parent = node instanceof Node2D ? node.parent : null;
    if (!(node instanceof Node2D) || !parent) return null;
    const m = movePlaneMatrix(node, parent);
    const inv = invert(m);
    if (!inv) return null;
    const p = applyToPoint(inv, { x: point.x, y: -point.y });
    if (behindCamera(m, p)) return null;
    const plane = parent._planeOf(node);
    if (!plane) return { x: p.x, y: -p.y };
    // A slot's frame is already centred on the node's box; the parent's is not.
    const box = node._placement() ? null : node.layoutBounds;
    return plane.toCoords(p.x - (box?.x ?? 0), (box?.y ?? 0) - p.y);
}

/**
 * Where `point` lands in the coordinates the node at `path` positions its children in ({@link
 * Node2D._planeOf}): the `x`/`y` a child takes to be centred there. `null` when its children are positioned in
 * pixels, which is how a host tells the two apart.
 */
export function childPlanePointAt(root: Node2D, path: string, point: Vector2): Vector2 | null {
    const parent = nodeAt(root, path);
    if (!(parent instanceof Node2D)) return null;
    const plane = parent._planeOf(null);
    if (!plane) return null;
    const inv = invert(childrenMatrix(parent));
    if (!inv) return null;
    const p = applyToPoint(inv, { x: point.x, y: -point.y });
    return plane.toCoords(p.x, -p.y);
}

/**
 * What keeps the node at `path` looking the same once it moves under `parentPath`, as a design tool does: each
 * of `offsets` carried to the one that puts its centre at the same place, plus the `turn` to add to its
 * rotation and the `scale` to multiply by so the parents' own turn and scale, cameras included, are undone.
 * `null` when that parent arranges children in a run or grid, sits inside the node, or either is missing.
 */
export function reparentPlacementAt(
    root: Node2D, path: string, parentPath: string, offsets: readonly Vector2[],
): ReparentPlacement | null {
    const node = nodeAt(root, path);
    const to = nodeAt(root, parentPath);
    const from = node instanceof Node2D ? node.parent : null;
    if (!(node instanceof Node2D) || !(from instanceof Node2D) || !(to instanceof Node2D)) return null;
    for (let at: Node | null = to; at; at = at.parent) if (at === node) return null;
    const box = node.layoutBounds;
    const plane = to._planeOf(null);
    const slot = plane ? null : to._slotFor({ width: box?.width ?? 0, height: box?.height ?? 0 });
    if (!plane && !slot) return null;
    const along = movePlaneMatrix(node, from);
    const back = invert(along);
    const into = invert(childrenMatrix(to));
    if (!back || !into) return null;

    const placed = node._placement();
    const was = childFold(from);
    const will = childFold(to);
    const turn = was.rotation + (placed?.rotation ?? 0) - will.rotation;
    const scale = will.scale === 0 ? 1 : (was.scale * (placed?.scale ?? 1)) / will.scale;
    const shift = node._centreShift(node.rotation + turn, node.scale * scale);

    // The plane the node's x/y move it on, where its centre is drawn now.
    const here = applyToPoint(back, applyToPoint(renderMatrix(node), { x: 0, y: 0 }));
    const own = from._planeOf(node);
    const pixels = (offset: Vector2): Vector2 => (own ? { ...own.toOffset(offset.x, offset.y) } : offset);
    const now = pixels({ x: node.x, y: node.y });
    const moved = offsets.map((offset) => {
        const o = pixels(offset);
        const drawn = applyToPoint(along, { x: here.x + o.x - now.x, y: here.y - (o.y - now.y) });
        const centre = applyToPoint(into, drawn);
        const x = centre.x - shift.x;
        const y = centre.y - shift.y;
        return plane ? plane.toCoords(x, -y) : { x: x - slot!.x, y: slot!.y - y };
    });
    return { offsets: moved, turn, scale };
}

export interface ReparentPlacement {
    offsets: Vector2[];
    /** Degrees clockwise to add to the node's rotation. */
    turn: number;
    /** The factor to multiply the node's scale by. */
    scale: number;
}

function childFold(parent: Node2D): { rotation: number; scale: number } {
    const folded = foldedTransform(parent);
    const cam = parent._cameraScope();
    return cam ? { rotation: folded.rotation - cam.heading, scale: folded.scale * cam.zoom } : folded;
}

export function nodeHandlesAt(root: Node2D, path: string): NodeHandle[] | null {
    const node = nodeAt(root, path);
    if (!(node instanceof Node2D)) return null;
    const m = renderMatrix(node);
    return node._handles().map(({ prop, at }) => {
        const p = applyToPoint(m, { x: at.x, y: -at.y });
        return { prop, at: { x: p.x, y: -p.y } };
    });
}

/** `null` when there is no such handle or the point is off the node's plane. */
export function handleValueAt(root: Node2D, path: string, prop: string, point: Vector2): Vector2 | null {
    const node = nodeAt(root, path);
    if (!(node instanceof Node2D)) return null;
    const m = renderMatrix(node);
    const inv = invert(m);
    if (!inv) return null;
    const p = applyToPoint(inv, { x: point.x, y: -point.y });
    if (behindCamera(m, p)) return null;
    return node._handleValue(prop, { x: p.x, y: -p.y });
}

/** The parent's frame at the node's depth, onto the screen: the plane its `x`/`y` slide it across. */
function movePlaneMatrix(node: Node2D, parent: Node2D): Matrix2D {
    const frame = spaceFrameOf(node) ? spaceFrameForChildren(parent) : null;
    if (!frame) {
        // A slotted node's `x`/`y` move it within its slot, which may be turned.
        const slot = node._slotMatrix();
        return slot ? multiply(childrenMatrix(parent), slot) : childrenMatrix(parent);
    }
    const slot = node._slotAffine();
    const plane = slot ? multiplyAffine3(frame.view, slot) : frame.view;
    const atDepth = multiplyAffine3(plane, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, node.depth]);
    return multiply(renderMatrix(frame.root), spaceScreenMatrix(frame.camera, atDepth));
}

/**
 * Under a perspective the inverse also answers for the plane's reflection behind the camera: a point there
 * projects to the same pixel with a negative `w` and is not on screen.
 */
function behindCamera(m: Matrix2D, local: Vector2): boolean {
    return isProjective(m) && (m.g ?? 0) * local.x + (m.h ?? 0) * local.y + (m.i ?? 1) <= 0;
}

/**
 * The same accumulation as {@link Node2D.global}, extended with camera scopes: a camera multiplies scale by
 * its `zoom` and adds `-heading` to rotation (the renderer applies `rotate(-heading)`).
 */
function foldedTransform(node: Node2D): { rotation: number; scale: number; opacity: number } {
    let rotation = 0;
    let scale = 1;
    let opacity = 1;
    for (let n: Node2D | null = node; n; n = n.parent) {
        const slot = n._placement();
        rotation += n.rotation + (slot?.rotation ?? 0);
        scale *= n.scale * (slot?.scale ?? 1);
        opacity *= n.opacity * (slot?.opacity ?? 1);
        // Skip the node's own camera: it scopes its children, not itself.
        const cam = n !== node ? n._cameraScope() : null;
        if (cam) {
            rotation -= cam.heading;
            scale *= cam.zoom;
        }
    }
    return { rotation, scale, opacity };
}

export function nodeBox(node: Node2D, path: string): NodeBox {
    const b = node._localBounds();
    /**
     * `worldAnchors` maps offsets centred on the matrix's origin, so shift the matrix onto the bounds' own centre
     * first: that lets a node whose ink is off-centre report a box on the ink. The matrix is canvas y-down; the
     * bounds are y-up, hence the sign on y.
     */
    const m = b.x === 0 && b.y === 0
        ? renderMatrix(node)
        : multiply(renderMatrix(node), translation(b.x, -b.y));
    const anchors = worldAnchors(m, b.width / 2, b.height / 2);
    const folded = foldedTransform(node);
    return {
        id: node.id,
        path,
        type: node.className,
        topLeft: anchors.topLeft,
        topRight: anchors.topRight,
        bottomRight: anchors.bottomRight,
        bottomLeft: anchors.bottomLeft,
        center: anchors.center,
        width: b.width,
        height: b.height,
        rotation: folded.rotation,
        scale: folded.scale,
        opacity: folded.opacity,
        locked: node.locked,
    };
}

/**
 * The one entry point that answers for a 3D node too, which a bare {@link nodeBox} cannot: a mesh has no box
 * of its own, only a projection into the viewport that holds it, and finding that viewport is part of
 * resolving the path (see `node-picking3d.ts`). Walks {@link Node._allChildren}, the paths every structural
 * walk produces.
 */
export function nodeBoxAt(root: Node2D, path: string): NodeBox | null {
    if (path === "") return nodeBox(root, path);

    let node: Node = root;
    let canvas: { node: Viewport3D; path: string } | null = null;
    const segments = path.split(".");
    for (let i = 0; i < segments.length; i++) {
        if (isViewport3D(node)) canvas = { node, path: prefixPath(segments, i) };
        const next = node._allChildren[Number(segments[i])];
        if (!next) return null;
        node = next;
    }

    if (node instanceof Node2D) return nodeBox(node, path);
    /**
     * A `Node3D` cannot be parented anywhere but a viewport (the engine throws), so a `null` here is a malformed
     * tree.
     */
    if (!canvas) return null;
    const frame = canvas3DFrame(canvas.node, canvas.path);
    return collectBoxes3D(canvas.node, frame, canvas.path).find((box) => box.path === path) ?? null;
}

/**
 * The resolution half of {@link nodeBoxAt}, for callers that want the node
 * (`PlaybackController.getNodePropsAt`).
 */
export function nodeAt(root: Node2D, path: string): Node | null {
    if (path === "") return root;
    let node: Node = root;
    for (const segment of path.split(".")) {
        const next = node._allChildren[Number(segment)];
        if (!next) return null;
        node = next;
    }
    return node;
}

function prefixPath(segments: readonly string[], count: number): string {
    return segments.slice(0, count).join(".");
}

/**
 * A gizmo's counterpart to {@link nodeBoxAt}, for where an arbitrary point near the node lands on screen; see
 * {@link Node3DFrame}. `null` for a 2D path too: {@link nodeBox} already answers everything a 2D handle needs.
 */
export function projectNode3DAt(
    root: Node2D,
    path: string,
    parentPoints: readonly Vector3[],
    localPoints: readonly Vector3[],
): Node3DFrame | null {
    if (path === "") return null;

    let node: Node = root;
    let canvas: { node: Viewport3D; path: string } | null = null;
    const segments = path.split(".");
    for (let i = 0; i < segments.length; i++) {
        if (isViewport3D(node)) canvas = { node, path: prefixPath(segments, i) };
        const next = node._allChildren[Number(segments[i])];
        if (!next) return null;
        node = next;
    }

    if (node instanceof Node2D || !canvas) return null;
    const frame = canvas3DFrame(canvas.node, canvas.path);
    return projectNode3D(canvas.node, frame, canvas.path, path, parentPoints, localPoints);
}

/**
 * Children paint over their parent and later siblings over earlier ones, so the walk tests children
 * last-to-first before the node itself.
 *
 * Skips fully transparent nodes (a scene built with spawn delays keeps not-yet-visible nodes at `opacity: 0`).
 * A node that clips, or pushes a camera, confines its subtree. The scene root is never returned.
 *
 * The hit region is {@link Node2D.hitTestSelf}: the rotated layout box by default, the declared outline for
 * shapes. `tolerance` is grab-slop in scene units applied outward from the ink; a host passes its
 * zoom-corrected pixel slop.
 *
 * Cost: {@link renderMatrix} walks to the root per node, so a pick is O(depth^2); scene trees are shallow,
 * fine at pointer rate. If it matters, thread the accumulated matrix down the walk.
 */
export function pickNode(root: Node2D, point: Vector2, tolerance = 0): NodeBox | null {
    return pickIn(root, "", point, tolerance, true);
}

function pickIn(node: Node2D, path: string, point: Vector2, tolerance: number, isRoot: boolean): NodeBox | null {
    if (node.opacity === 0 || node.hidden) return null;
    const drawn = spaceVisibility(node, isRoot);
    if (drawn === "none") return null;

    const inside = drawn === "all" && containsPoint(node, point, tolerance);
    /**
     * A clipping node (or one opening a camera viewport) gates its subtree, unless it draws nothing of its own.
     */
    if (!inside && drawn === "all" && node._confinesChildren()) return null;

    /**
     * A `Canvas3D`'s children come in both dimensions, and its 2D ones are indexed against the whole list; see
     * {@link childSlots}.
     */
    const children = childSlots(node);
    const order = paintOrder(node, children);
    for (let k = order.length - 1; k >= 0; k--) {
        const i = order[k];
        const slot = children[i];
        if (slot === null) continue;
        const hit = pickIn(slot, nodePath(path, i), point, tolerance, false);
        if (hit) return hit;
    }

    /**
     * The 3D scene draws under the 2D children and over the canvas's own fill, so it is tested in that order: a
     * HUD label beats the mesh behind it, the mesh beats the viewport.
     */
    if (isViewport3D(node) && inside) {
        const hit = pickNode3D(node, canvas3DFrame(node, path), point, tolerance, path);
        if (hit) return hit;
    }

    if (isRoot) return null;
    /**
     * A locked node declines to be the answer but still gated its subtree above, so a click inside a locked group
     * lands on nothing rather than falling through.
     */
    if (node.locked) return null;
    return inside ? nodeBox(node, path) : null;
}

/**
 * In draw order (parents before children). Skips `opacity: 0` nodes and the root, as {@link pickNode} does.
 *
 * A `Canvas3D` also contributes a box per `Node3D` inside it (see `node-picking3d.ts`), after the viewport's
 * own box and before its 2D children's, where the 3D pass is painted; among themselves near camera first.
 */
export function collectBoxes(node: Node2D, path: string, out: NodeBox[], isRoot: boolean): void {
    if (node.opacity === 0 || node.hidden) return;
    const drawn = spaceVisibility(node, isRoot);
    if (drawn === "none") return;
    /**
     * Locked nodes keep their box so a host can outline one picked from its layer tree; the box carries the flag
     * so a marquee can leave it out without a second walk.
     */
    if (!isRoot && drawn === "all") out.push(nodeBox(node, path));

    if (isViewport3D(node)) {
        for (const box of collectBoxes3D(node, canvas3DFrame(node, path), path)) out.push(box);
    }

    const children = childSlots(node);
    for (const i of paintOrder(node, children)) {
        const slot = children[i];
        if (slot !== null) collectBoxes(slot, nodePath(path, i), out, false);
    }
}

/**
 * `"all"` outside a space and for a node facing the camera; `"children"` for one edge-on or behind the lens,
 * whose own paint is skipped while its children, placed by frames of their own, are not; `"none"` for one the
 * renderer skips outright (a hidden back face, or a flattening node with nothing on screen).
 */
function spaceVisibility(node: Node2D, isRoot: boolean): "all" | "children" | "none" {
    if (isRoot) return "all";
    const frame = spaceFrameOf(node);
    if (!frame) return "all";
    if (!node.backfaceVisible && frame.facesAway) return "none";
    if (frame.paints) return "all";
    return node._rendersChildrenInSpace() ? "children" : "none";
}

/**
 * The slots of `children` in the order the renderer paints them: authored
 * order, except among siblings in a space, which paint far to near.
 */
function paintOrder(node: Node2D, children: readonly (Node2D | null)[]): number[] {
    const natural = children.map((_, i) => i);
    const frame = spaceFrameForChildren(node);
    if (!frame) return natural;
    const slots = natural.filter((i) => children[i] !== null);
    const frames = slots.map((i) => spaceChildFrame(frame, children[i]!));
    return spaceChildOrder(frames).map((k) => slots[k]);
}

/**
 * Everywhere but a `Canvas3D` this is just `children`. A `Canvas3D` holds both dimensions and its
 * `Node2D.children` drops the meshes, which would renumber its HUD children and hand each the path of an
 * earlier sibling; so its slots come from the authored list with the 3D ones blanked, keeping the document's
 * indices.
 */
function childSlots(node: Node2D): readonly (Node2D | null)[] {
    if (!(isViewport3D(node))) return node.children;
    return node._allChildren.map((child) => (child instanceof Node2D ? child : null));
}

function canvas3DFrame(canvas: Viewport3D, path: string): Canvas3DFrame {
    return { box: nodeBox(canvas, path), matrix: renderMatrix(canvas) };
}

function containsPoint(node: Node2D, point: Vector2, tolerance: number): boolean {
    const m = renderMatrix(node);
    const inv = invert(m);
    if (!inv) return false;                       // zero scale — nothing to hit
    /**
     * The render matrix works in canvas (y-down) space and `worldAnchors` flips y in and out, so the inverse does
     * the same to land in the node's centred, y-up local frame (what `hitTestSelf` and the clip descriptors use).
     */
    const p = applyToPoint(inv, { x: point.x, y: -point.y });
    if (behindCamera(m, p)) return false;
    return node._hitTestSelf({ x: p.x, y: -p.y }, tolerance);
}
