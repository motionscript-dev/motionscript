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
 * Pure geometry for editor-style direct manipulation: where a node's pixels
 * landed, and which node is under a point. No controller state, so it can be
 * exercised against hand-built node trees.
 *
 * **Space.** Everything here is in *viewport space*: origin at the viewport
 * centre, y-up, units = the viewport pixels the player was given. That is the
 * same space `Node2D.global` reports, plus the camera — see {@link renderMatrix}.
 */

/**
 * A node's on-screen box at the current frame, in viewport space (origin at the
 * viewport centre, y-up).
 *
 * Unlike {@link Node2D.global} this folds in any active camera scope, so it
 * describes where the node's pixels actually landed — which is what an editor
 * overlay needs in order to draw a selection box over them.
 */
export interface NodeBox {
    /** Per-instance id — changes on every rebuild. Use {@link path} to key across rebuilds. */
    id: string;
    /** Structural path from the scene root (`""` is the root); stable across rebuilds. */
    path: string;
    /** Node2D class name, e.g. `Rect`, `Text`. */
    type: string;
    /** Corners in draw order, viewport space. Rotated/scaled — not axis-aligned. */
    topLeft: Vector2;
    topRight: Vector2;
    bottomRight: Vector2;
    bottomLeft: Vector2;
    center: Vector2;
    /**
     * Size of the box before rotation/scale, in scene units — the node's layout
     * size for everything whose drawing fills its cell, and the ink's own extent
     * where the two differ (see {@link Node2D._localBounds}; a boolean group
     * reports the extent of its children's ink, not its layout rect).
     */
    width: number;
    height: number;
    /** Folded rotation (degrees clockwise) and uniform scale, camera included. */
    rotation: number;
    scale: number;
    /** Effective alpha; `0` means the node is present but invisible. */
    opacity: number;
    /**
     * The editor's padlock — see {@link NodeEditorState.locked}.
     *
     * Carried here rather than left for the host to look up, because the two
     * things that need it are a marquee sweep and a gizmo's handles, and both are
     * already holding the box. A locked node is never returned by
     * {@link pickNode}; it appears in {@link collectBoxes} so a host can still
     * outline one selected from its layer tree.
     */
    locked: boolean;
}

/**
 * The renderer's CTM at `node` — every ancestor's local matrix from the scene
 * root down, with a camera scope inserted wherever an ancestor pushes one
 * ({@link Node2D._cameraScope}; `Canvas2D`/`Camera` call `beginCamera` between
 * their own transform and their children's).
 *
 * A node inside a 2.5D space is placed by its frame instead — the whole
 * projection from its own plane to the space root's, built by the same
 * `node-space.ts` the renderer uses — so it is a homography, and `nodeBox`
 * reports the projected corners.
 *
 * Mirrors the render walk exactly, including the camera's `translate(rect.x,
 * -rect.y)` — if a box ever disagrees with the pixels, the divergence is here.
 *
 * `@internal`, and shared with `text-geometry.ts`: a caret drawn over a node has
 * to land in the same space as the box drawn around it, so both must come from
 * this one walk rather than two that agree by inspection.
 */
/** @internal */
export function renderMatrix(node: Node2D): Matrix2D {
    const frame = spaceFrameOf(node);
    if (frame) return multiply(renderMatrix(frame.root), frame.screen);
    const parent = node.parent;
    return parent ? multiply(childrenMatrix(parent), node._localMatrix()) : node._localMatrix();
}

/**
 * The CTM `parent`'s children are placed under, before their own transform: its
 * render matrix, then whatever camera it opens. For a space root that is the
 * camera over its own plane; inside a space it is the parent's own frame, since
 * a child's place is measured in its parent's plane.
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
 * Where `point` (viewport space) lands on the plane the node at `path` moves in
 * when its `x`/`y` change — its parent's, through any camera in between, pushed
 * out to the node's own `depth` in a space — in its parent's frame: centred on
 * the parent (on its slot, for a node a parent places — see `ChildPlacement`),
 * y-up. `null` when the path does not name a 2D node below the
 * root, or that plane cannot be reached at that point (edge-on, or the point is
 * behind the camera).
 *
 * Two answers differ by exactly the change of `x`/`y` that carries the node from
 * one point to the other — what a move handle needs once a node can sit in
 * depth, where a screen delta is no longer a parent delta.
 *
 * Under a parent with coordinates of its own (`Node2D._planeOf`) the answer is
 * in them, and is the `x`/`y` that centres the node on `point`.
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
 * Where `point` (viewport space) lands in the coordinates the node at `path`
 * positions its children in ({@link Node2D._planeOf}): the `x`/`y` a child takes
 * to be centred there, before it exists. `null` when that node's children are
 * positioned in pixels, which is how a host tells the two apart.
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
 * What keeps the node at `path` looking exactly as it does once it moves under
 * the node at `parentPath`, as a design tool does: each of `offsets` (an
 * `x`/`y` it takes under its parent now: its own, or where a move takes it)
 * carried to the one that puts its centre at the same place there, and the
 * `turn` to add to its rotation and the `scale` to multiply its scale by so
 * the parents' own turn and scale, cameras included, are undone. `null` when
 * that parent arranges its children in a run or a grid, sits inside the node,
 * or either is not here.
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

/** What {@link reparentPlacementAt} answers. */
export interface ReparentPlacement {
    /** Each offset asked about, under the new parent. */
    offsets: Vector2[];
    /** Degrees (clockwise) to add to the node's rotation, and to where its turns end. */
    turn: number;
    /** The factor to multiply the node's scale by, and where its scalings end. */
    scale: number;
}

/** The rotation and scale a child of `parent` is drawn under: its fold, then the camera it opens. */
function childFold(parent: Node2D): { rotation: number; scale: number } {
    const folded = foldedTransform(parent);
    const cam = parent._cameraScope();
    return cam ? { rotation: folded.rotation - cam.heading, scale: folded.scale * cam.zoom } : folded;
}

/**
 * The node at `path`'s {@link NodeHandle}s with `at` in viewport space, where the
 * pixels put them; `null` when the path names no 2D node.
 */
export function nodeHandlesAt(root: Node2D, path: string): NodeHandle[] | null {
    const node = nodeAt(root, path);
    if (!(node instanceof Node2D)) return null;
    const m = renderMatrix(node);
    return node._handles().map(({ prop, at }) => {
        const p = applyToPoint(m, { x: at.x, y: -at.y });
        return { prop, at: { x: p.x, y: -p.y } };
    });
}

/**
 * The value of `prop` that puts its handle on the node at `path` under `point`
 * (viewport space), or `null` when there is no such handle or the point is off
 * the node's plane.
 */
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
 * Under a perspective the inverse also answers for the plane's reflection behind
 * the camera: a point there projects to the same pixel with a negative `w`, and
 * is not on screen at all.
 */
function behindCamera(m: Matrix2D, local: Vector2): boolean {
    return isProjective(m) && (m.g ?? 0) * local.x + (m.h ?? 0) * local.y + (m.i ?? 1) <= 0;
}

/**
 * Folded rotation / scale / opacity from the scene root down to `node`, matching
 * the renderer's nested transforms and its pass-through alpha fold. The same
 * accumulation {@link Node2D.global} does, extended with the camera scopes: a
 * camera multiplies the scale by its `zoom` and adds `-heading` to the rotation
 * (the renderer applies `rotate(-heading)`).
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

/** Build the viewport-space box for `node` at the current frame. */
export function nodeBox(node: Node2D, path: string): NodeBox {
    const b = node._localBounds();
    // `worldAnchors` maps offsets centred on the matrix's origin, so shift the
    // matrix onto the bounds' own centre first — that is what lets a node whose
    // ink is off-centre report a box that actually sits on the ink.
    // The matrix is canvas y-down; the bounds are y-up, hence the sign on y.
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
 * The box at a structural path, in either dimension, or `null` when the path
 * doesn't resolve.
 *
 * The one entry point that answers for a 3D node as well as a 2D one, which a
 * bare {@link nodeBox} cannot: a mesh is not a `Node2D` and has no box of its
 * own — what it has is a projection into the viewport that holds it, and finding
 * that viewport is part of resolving the path (see `node-picking3d.ts`).
 *
 * Walks {@link Node._allChildren}, so the paths it accepts are the ones every
 * other structural walk in the engine produces.
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
    // A 3D node: ask the viewport that holds it. There is always one — a `Node3D`
    // cannot be parented anywhere else (the engine throws rather than allowing
    // it) — so a `null` here is a malformed tree rather than a missing case.
    if (!canvas) return null;
    const frame = canvas3DFrame(canvas.node, canvas.path);
    return collectBoxes3D(canvas.node, frame, canvas.path).find((box) => box.path === path) ?? null;
}

/**
 * The node at a structural path, in either dimension, or `null` when the path
 * doesn't resolve.
 *
 * The resolution half of {@link nodeBoxAt}, split out for callers that want the
 * node rather than its box — `PlaybackController.getNodePropsAt`, which reads a
 * node's own props in its own space. Walks {@link Node._allChildren}, so it
 * accepts the same paths every other structural walk in the engine produces.
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

/** The first `count` segments of a split path, rejoined. */
function prefixPath(segments: readonly string[], count: number): string {
    return segments.slice(0, count).join(".");
}

/**
 * Project a handful of points around the `Node3D` at `path`, or `null` when
 * the path doesn't resolve to a 3D node — a gizmo's counterpart to
 * {@link nodeBoxAt}, for the one thing a box can't answer: where would an
 * arbitrary point *near* the node, not just its extent, land on screen. See
 * {@link Node3DFrame} for the two point sets and the space each is in.
 *
 * `null` for a 2D path too, unlike `nodeBoxAt` — a `Node2D` has no matrix a
 * caller would ask this for; {@link nodeBox} already answers everything a 2D
 * handle needs directly in viewport space.
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
 * The topmost node whose hit region contains `point` (viewport space, y-up,
 * origin at the viewport centre), or `null`. Children paint over their parent and
 * later siblings over earlier ones, so the walk tests children last-to-first
 * before falling back to the node itself.
 *
 * Skips fully transparent nodes — a scene built with spawn delays keeps
 * not-yet-visible nodes in the tree at `opacity: 0`, and those must not be
 * selectable. A node that clips (or pushes a camera, which clips to its viewport)
 * confines its subtree: a point outside its box cannot hit anything inside it.
 * The scene root is never returned; it is the stage, not a selectable node.
 *
 * The hit region is {@link Node2D.hitTestSelf} — the rotated layout box by default,
 * narrowed to the declared outline for shapes. A click in the corner of a rect's
 * box selects it; a click in the empty notch of a star's box does not.
 *
 * `tolerance` is grab-slop in scene units, applied outward from the ink. A host
 * passes its zoom-corrected pixel slop so the grab area stays constant on screen.
 * It is what makes thin shapes reachable.
 *
 * Cost: {@link renderMatrix} walks to the root per node, making a pick O(depth²).
 * Scene trees here are shallow (tens of nodes, depth < 10), so this is fine at
 * pointer rate. If it ever matters, thread the parent's accumulated matrix down
 * through the walk instead of recomputing — a change confined to this file.
 */
export function pickNode(root: Node2D, point: Vector2, tolerance = 0): NodeBox | null {
    return pickIn(root, "", point, tolerance, true);
}

function pickIn(node: Node2D, path: string, point: Vector2, tolerance: number, isRoot: boolean): NodeBox | null {
    if (node.opacity === 0 || node.hidden) return null;
    const drawn = spaceVisibility(node, isRoot);
    if (drawn === "none") return null;

    const inside = drawn === "all" && containsPoint(node, point, tolerance);
    // A clipping node (or one that opens a camera viewport) gates its subtree —
    // unless it is drawing nothing of its own, when it clips nothing either.
    if (!inside && drawn === "all" && node._confinesChildren()) return null;

    // A `Canvas3D`'s children come in both dimensions, and its 2D ones are
    // indexed against the *whole* list — see {@link childSlots}.
    const children = childSlots(node);
    const order = paintOrder(node, children);
    for (let k = order.length - 1; k >= 0; k--) {
        const i = order[k];
        const slot = children[i];
        if (slot === null) continue;
        const hit = pickIn(slot, nodePath(path, i), point, tolerance, false);
        if (hit) return hit;
    }

    // The 3D scene draws under the 2D children and over the canvas's own fill, so
    // it is tested in that order too: a HUD label wins over the mesh behind it,
    // and the mesh wins over the viewport it sits in.
    if (isViewport3D(node) && inside) {
        const hit = pickNode3D(node, canvas3DFrame(node, path), point, tolerance, path);
        if (hit) return hit;
    }

    if (isRoot) return null;
    // A locked node declines to *be* the answer while still having gated its
    // subtree above — so a click inside a locked group lands on nothing rather
    // than falling through to whatever is behind the group.
    if (node.locked) return null;
    return inside ? nodeBox(node, path) : null;
}

/**
 * Collect every visible node's box in draw order (parents before children, so a
 * host can paint them in the order the renderer did). Skips `opacity: 0` nodes
 * and the scene root, matching {@link pickNode}.
 *
 * A `Canvas3D` also contributes a box per `Node3D` inside it, projected into its
 * plane — see `node-picking3d.ts`. They sit after the viewport's own box and
 * before its 2D children's, which is where the 3D pass is painted; among
 * themselves they are ordered **near camera first**, because a 3D scene has no
 * draw order of its own for them to be in.
 */
export function collectBoxes(node: Node2D, path: string, out: NodeBox[], isRoot: boolean): void {
    if (node.opacity === 0 || node.hidden) return;
    const drawn = spaceVisibility(node, isRoot);
    if (drawn === "none") return;
    // Locked nodes keep their box — a host still has to draw a selection outline
    // around one picked from its layer tree. What the box carries is the flag, so
    // a marquee can leave it out without a second walk.
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
 * How much of `node` a space lets the renderer draw: `"all"` outside a space and
 * for a node facing the camera in front of it; `"children"` for one edge-on or
 * behind the lens, whose own paint is skipped while its children, placed by
 * frames of their own, are not; `"none"` for one the renderer skips outright — a
 * hidden back face, or a flattening node with nothing on screen.
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
 * The node's children as **index slots**, with a `null` wherever the slot holds
 * something this walk doesn't descend into.
 *
 * Everywhere but a `Canvas3D` this is just `children`, and the array is returned
 * untouched. A `Canvas3D` is the one node holding both dimensions, and its
 * `Node2D.children` drops the meshes — which would renumber its HUD children and
 * hand every one of them the path of an earlier sibling. So its slots are taken
 * from the authored list with the 3D ones blanked out: same indices as the
 * document, and the meshes reached through their own walk instead.
 */
function childSlots(node: Node2D): readonly (Node2D | null)[] {
    if (!(isViewport3D(node))) return node.children;
    return node._allChildren.map((child) => (child instanceof Node2D ? child : null));
}

/** What the 3D walk needs to know about the viewport it is projecting into. */
function canvas3DFrame(canvas: Viewport3D, path: string): Canvas3DFrame {
    return { box: nodeBox(canvas, path), matrix: renderMatrix(canvas) };
}

/** Map `point` into `node`'s local space and ask the node whether it was hit. */
function containsPoint(node: Node2D, point: Vector2, tolerance: number): boolean {
    const m = renderMatrix(node);
    const inv = invert(m);
    if (!inv) return false;                       // zero scale — nothing to hit
    // The render matrix works in canvas (y-down) space; `worldAnchors` flips y in
    // and back out, so the inverse does the same to land in the node's centred,
    // y-up local frame — the space `hitTestSelf` and the clip descriptors use.
    const p = applyToPoint(inv, { x: point.x, y: -point.y });
    if (behindCamera(m, p)) return false;
    return node._hitTestSelf({ x: p.x, y: -p.y }, tolerance);
}
