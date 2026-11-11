import { identity, invert, multiply, type Matrix2D } from "@/attributes/layout/matrix2d";
import {
    cameraSide,
    multiplyAffine3,
    nearCoverage,
    nearCutPolygon,
    spacePaintOrder,
    spacePlane,
    spaceScreenMatrix,
    spaceViewMatrix,
    type Affine3,
    type SpaceCamera,
    type SpacePlane,
} from "@/attributes/layout/space3d";
import { Clip } from "@/render/clip";
import { PathBuilder } from "@/render/descriptors/path-builder";
import type { Node2D } from "./node2d";

/** Companion for {@link Node2D}'s 2.5D space: where a node sits in one for a frame and the order siblings paint in. The renderer and picking both build frames here, so a box around a node can't disagree with where it was painted. */

/** Where one node sits in a space for one frame. */
/** @internal */
export interface SpaceFrame {
    /** The node the space is seen from — whose camera it is. */
    readonly root: Node2D;
    readonly camera: SpaceCamera;
    /** This node's local frame → view space. */
    readonly view: Affine3;
    /** This node's local frame → the root's canvas: the whole projection. */
    readonly screen: Matrix2D;
    /** What this node's scope leaves on the canvas, relative to the root's: `screen`, or its parent's when it pushes nothing. */
    readonly pushed: Matrix2D;
    /** What the node concats in `applyTransform`: the parent's `pushed` undone, then `screen`. */
    readonly local: Matrix2D;
    /** No tilt and no depth: the node lies in its parent's plane. */
    readonly flat: boolean;
    readonly plane: SpacePlane;
    /** False when the node is edge-on or wholly behind the camera: nothing of its own to draw and no usable matrix to push, though its children (placed by their own frames) are still drawn. */
    readonly paints: boolean;
    readonly facesAway: boolean;
    /** Confines the node's own paint to what is in front of the lens, while the lens is passing through it. */
    readonly nearCut: Clip | null;
}

const IDENTITY: Matrix2D = identity();

/** The frame a space root hands its children: the camera over the root's own plane. */
/** @internal */
export function spaceRootFrame(root: Node2D, camera: SpaceCamera): SpaceFrame {
    const view = spaceViewMatrix(camera);
    return {
        root,
        camera,
        view,
        screen: spaceScreenMatrix(camera, view),
        pushed: IDENTITY,
        local: IDENTITY,
        flat: true,
        plane: spacePlane(view, { x: 0, y: 0, width: 0, height: 0 }),
        paints: false,
        facesAway: false,
        nearCut: null,
    };
}

/** `child`'s frame, placed in `parent`'s. */
/** @internal */
export function spaceChildFrame(parent: SpaceFrame, child: Node2D): SpaceFrame {
    const own = child._spaceMatrix();
    const view = multiplyAffine3(parent.view, own);
    const camera = parent.camera;
    const screen = spaceScreenMatrix(camera, view);
    const box = inkBox(child);
    const plane = spacePlane(view, box);
    const { side, edgeOn } = cameraSide(camera, plane);
    const coverage = nearCoverage(camera, plane);

    let local = IDENTITY;
    let paints = !edgeOn && coverage !== "none";
    if (paints) {
        if (parent.pushed === IDENTITY) {
            local = screen;
        } else {
            const undo = invert(parent.pushed);
            if (undo) local = multiply(undo, screen);
            else paints = false;
        }
    }

    return {
        root: parent.root,
        camera,
        view,
        screen,
        pushed: paints ? screen : parent.pushed,
        local,
        flat: own[2] === 0 && own[6] === 0 && own[8] === 0 && own[9] === 0 && own[11] === 0,
        plane,
        paints,
        facesAway: !edgeOn && side < 0,
        nearCut: paints && coverage === "some" ? nearCutClip(screen, box) : null,
    };
}

/** The frame `node` is placed by, or `null` when in no space: the walk picking takes (the renderer threads frames down). In a space when an ancestor opens one and every node between hands its children on via {@link Node2D._rendersChildrenInSpace}; a mask or nested camera flattens its subtree into its own plane. */
/** @internal */
export function spaceFrameOf(node: Node2D): SpaceFrame | null {
    const chain: Node2D[] = [];
    for (let n: Node2D | null = node.parent; n; n = n.parent) {
        const camera = n._spaceCamera();
        if (camera) {
            let frame = spaceRootFrame(n, camera);
            for (let i = chain.length - 1; i >= 0; i--) frame = spaceChildFrame(frame, chain[i]);
            return spaceChildFrame(frame, node);
        }
        if (!n._rendersChildrenInSpace()) return null;
        chain.push(n);
    }
    return null;
}

/** The frame `parent` passes its children, whether it is a space root or a node inside one. */
/** @internal */
export function spaceFrameForChildren(parent: Node2D): SpaceFrame | null {
    const camera = parent._spaceCamera();
    if (camera) return spaceRootFrame(parent, camera);
    if (!parent._rendersChildrenInSpace()) return null;
    return spaceFrameOf(parent);
}

/** The order `children` paint in, far to near, as indices; siblings all in their parent's plane need no test and keep authored order. */
/** @internal */
export function spaceChildOrder(frames: readonly SpaceFrame[]): number[] {
    if (frames.length < 2 || frames.every((f) => f.flat)) return frames.map((_, i) => i);
    return spacePaintOrder(frames[0].camera, frames.map((f) => f.plane));
}

/** The node's ink in its own frame, centred and y-down — the frame its matrices map from. */
function inkBox(node: Node2D): { x: number; y: number; width: number; height: number } {
    const b = node._localBounds();
    return { x: b.x, y: -b.y, width: b.width, height: b.height };
}

/** Grown past the ink by this, plus half the box: a shadow, stroke or glow must not be cut along the edge while the lens passes through. */
const NEAR_CUT_MARGIN = 128;

function nearCutClip(screen: Matrix2D, box: { x: number; y: number; width: number; height: number }): Clip | null {
    const polygon = nearCutPolygon(screen, box, Math.max(box.width, box.height) / 2 + NEAR_CUT_MARGIN);
    if (!polygon) return null;
    // Path commands are authored y-up; the polygon is in the node's y-down frame.
    const path = new PathBuilder().moveTo(polygon[0].x, -polygon[0].y);
    for (let i = 1; i < polygon.length; i++) path.lineTo(polygon[i].x, -polygon[i].y);
    // A symmetric frame keeps the path where it was drawn rather than centring it on its own box.
    const reach = Math.max(...polygon.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
    return new Clip().path(path.close().toPathState({ centerBounds: [-reach, -reach, reach, reach] }));
}
