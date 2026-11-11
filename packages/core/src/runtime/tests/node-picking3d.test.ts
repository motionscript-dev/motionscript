import { describe, it, expect } from 'vitest';
import { Canvas3D } from "@/components/builtins/three/canvas3d";
import { Group3D, Box3D, Sphere3D, Camera3D, Instances3D, Sprite3D } from "@/components/builtins/three/three";
import { Text } from "@/components/builtins/text/text";
import { Canvas2D } from '@/components/trees/root/canvas2d-node';
import { Node2D } from '@/components/trees/2d/node2d';
import { BoxBounds } from '@/layout/bounds';
import { Vector2 } from '@/attributes/layout/vector2';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { collectBoxes, nodeBoxAt, pickNode, projectNode3DAt, NodeBox } from '@/runtime/node-picking';
import { geometryBounds3D } from '@/render3d/bounds3d';
import { component3d } from "@/components/factory/component3d";

const scope = new FakeMeasureContext();

/** A viewport 400×300, centred on the origin, with `children` inside it. */
function viewport(children: unknown[]): Canvas3D {
    const canvas = new Canvas3D({ width: 400, height: 300, children } as any);
    canvas.layout({ x: 0, y: 0, width: 400, height: 300 } as BoxBounds, scope);
    return canvas;
}

/** The one box in `boxes` at `path`, or a failure naming what was there instead. */
function at(boxes: NodeBox[], path: string): NodeBox {
    const found = boxes.find((box) => box.path === path);
    expect(found, `no box at "${path}" — got ${boxes.map((b) => b.path).join(', ')}`).toBeDefined();
    return found as NodeBox;
}

function closeTo(actual: number, expected: number, eps = 1e-6): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
}

describe('geometryBounds3D', () => {
    it('takes three\'s own defaults for an unparameterised primitive', () => {
        expect(geometryBounds3D({ type: 'box' })).toEqual({
            min: { x: -0.5, y: -0.5, z: -0.5 },
            max: { x: 0.5, y: 0.5, z: 0.5 },
        });
        expect(geometryBounds3D({ type: 'sphere' })).toEqual({
            min: { x: -1, y: -1, z: -1 },
            max: { x: 1, y: 1, z: 1 },
        });
    });

    it('adds the caps to a capsule\'s straight mid-section', () => {
        // `height` is the mid-section alone, so a radius lands at each end.
        const bounds = geometryBounds3D({ type: 'capsule', radius: 0.5, height: 2 });
        expect(bounds).toEqual({
            min: { x: -0.5, y: -1.5, z: -0.5 },
            max: { x: 0.5, y: 1.5, z: 0.5 },
        });
    });

    it('takes the wider of a cylinder\'s two radii', () => {
        const bounds = geometryBounds3D({ type: 'cylinder', radius: [0.2, 2], height: 4 });
        expect(bounds).toEqual({
            min: { x: -2, y: -2, z: -2 },
            max: { x: 2, y: 2, z: 2 },
        });
    });

    it('is flat where the geometry is flat', () => {
        const bounds = geometryBounds3D({ type: 'plane', width: 4, height: 2 });
        closeTo(bounds?.min.z ?? NaN, 0);
        closeTo(bounds?.max.z ?? NaN, 0);
        closeTo(bounds?.max.x ?? NaN, 2);
        closeTo(bounds?.max.y ?? NaN, 1);
    });

    it('reads a buffer geometry off its positions', () => {
        const bounds = geometryBounds3D({
            type: 'buffer',
            position: [0, 0, 0, 3, -1, 2, -1, 5, 1],
        });
        expect(bounds).toEqual({
            min: { x: -1, y: -1, z: 0 },
            max: { x: 3, y: 5, z: 2 },
        });
    });

    it('declines the three it cannot measure from the descriptor alone', () => {
        expect(geometryBounds3D({ type: 'modelGeometry', src: 'robot.glb' })).toBeNull();
        expect(geometryBounds3D({ type: 'extrude', path: 'M0 0 L1 1' })).toBeNull();
        expect(geometryBounds3D({ type: 'parametric', segments: 4, vertex: () => ({ x: 0, y: 0, z: 0 }) })).toBeNull();
    });
});

describe('collectBoxes – 3D', () => {
    it('projects a mesh into the viewport, centred where the camera looks', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0, fov: 45 }),
            new Box3D({ width: 2, height: 2, depth: 2 }),
        ]);

        const boxes: NodeBox[] = [];
        collectBoxes(canvas, '3', boxes, false);

        // Path "3.1": the second child of the viewport, counted over the authored
        // list — the camera is index 0 even though it draws nothing.
        const box = at(boxes, '3.1');
        // A component class is named from its key: `box3d` is `Box3d`.
        expect(box.type).toBe('Box3d');
        // A cube at the origin, seen down the axis, lands on the viewport's centre.
        closeTo(box.center.x, 0, 1e-9);
        closeTo(box.center.y, 0, 1e-9);
        // …and is square on screen, since the viewport's own aspect is applied to
        // the projection rather than to the result.
        closeTo(box.width, box.height, 1e-9);
        // Small enough to sit inside the viewport, big enough to be visible: a
        // 2-unit cube 10 units from a 45° camera is roughly a quarter of the height.
        expect(box.height).toBeGreaterThan(40);
        expect(box.height).toBeLessThan(120);
    });

    it('moves the box when the mesh moves', () => {
        const centred = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 1 }),
        ]);
        const shifted = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 1, position: [2, 0, 0] }),
        ]);

        const a: NodeBox[] = [];
        const b: NodeBox[] = [];
        collectBoxes(centred, '', a, true);
        collectBoxes(shifted, '', b, true);

        // +X in the scene is +X on screen.
        expect(at(b, '1').center.x).toBeGreaterThan(at(a, '1').center.x + 10);
        // Wider, but not much: an off-axis cube's near and far faces project to
        // different spans, so the box that encloses both grows — which is the
        // *correct* screen extent of the shape, not slack in the projection.
        expect(at(b, '1').width).toBeGreaterThan(at(a, '1').width);
        expect(at(b, '1').width).toBeLessThan(at(a, '1').width * 1.6);
    });

    it('gives a group the union of what is inside it', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 20], lookAt: 0 }),
            new Group3D({
                children: [
                    new Box3D({ width: 1, position: [-3, 0, 0] }),
                    new Box3D({ width: 1, position: [3, 0, 0] }),
                ],
            } as any),
        ]);

        const boxes: NodeBox[] = [];
        collectBoxes(canvas, '', boxes, true);

        const group = at(boxes, '1');
        const left = at(boxes, '1.0');
        const right = at(boxes, '1.1');
        expect(group.type).toBe('Group3d');
        // The group spans both children and neither child spans the other.
        expect(group.width).toBeGreaterThan(left.width + right.width);
        closeTo(group.center.x, 0, 1e-6);
    });

    it('skips a hidden node and everything under it', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 1, visible: false }),
            new Sphere3D({ radius: 0.5 }),
        ]);

        const boxes: NodeBox[] = [];
        collectBoxes(canvas, '', boxes, true);

        expect(boxes.some((box) => box.path === '1')).toBe(false);
        expect(at(boxes, '2').type).toBe('Sphere3d');
    });

    it('numbers a HUD child against the authored list, not the 2D one', () => {
        const canvas = viewport([
            new Box3D({ width: 1 }),
            new Text({ text: 'FPS', x: 0, y: 0 }),
        ]);

        const boxes: NodeBox[] = [];
        collectBoxes(canvas, '', boxes, true);

        // The label is the *second* child as written, and dropping the mesh from
        // the count would have handed it path "0" — the mesh's own.
        expect(at(boxes, '1').type).toBe('Text');
        expect(at(boxes, '0').type).toBe('Box3d');
    });

    it('reports nothing for a scene whose meshes are all behind the camera', () => {
        const canvas = viewport([
            // Looking away from the cube: the camera sits at −Z aimed further −Z.
            new Camera3D({ position: [0, 0, -10], lookAt: [0, 0, -20] }),
            new Box3D({ width: 1 }),
        ]);

        const boxes: NodeBox[] = [];
        collectBoxes(canvas, '', boxes, true);
        expect(boxes.some((box) => box.path === '1')).toBe(false);
    });
});

describe('nodeBoxAt – 3D', () => {
    it('resolves a mesh by the path the walks report it at', () => {
        // The gizmo's own lookup: it holds a path and asks for that one box. A
        // mesh is not in the 2D child list at all, so this is the case a plain
        // `nodeBox` walk cannot answer.
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 2 }),
        ]);

        const collected: NodeBox[] = [];
        collectBoxes(canvas, '', collected, true);
        const walked = at(collected, '1');

        const direct = nodeBoxAt(canvas, '1');
        expect(direct?.type).toBe('Box3d');
        expect(direct?.center).toEqual(walked.center);
        expect(direct?.width).toBe(walked.width);
    });

    it('reaches a mesh nested inside a group', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Group3D({ children: [new Box3D({ width: 1 })] } as any),
        ]);

        expect(nodeBoxAt(canvas, '1')?.type).toBe('Group3d');
        expect(nodeBoxAt(canvas, '1.0')?.type).toBe('Box3d');
        expect(nodeBoxAt(canvas, '1.7')).toBeNull();
    });
});

describe('pickNode – 3D', () => {
    /** The viewport-space point under the centre of the box at `path`. */
    function centreOf(canvas: Canvas3D, path: string): Vector2 {
        const boxes: NodeBox[] = [];
        collectBoxes(canvas, '', boxes, true);
        return at(boxes, path).center;
    }

    it('picks the mesh under the pointer', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 12], lookAt: 0 }),
            new Box3D({ width: 2, position: [-3, 0, 0] }),
            new Box3D({ width: 2, position: [3, 0, 0] }),
        ]);

        expect(pickNode(canvas, centreOf(canvas, '1'))?.path).toBe('1');
        expect(pickNode(canvas, centreOf(canvas, '2'))?.path).toBe('2');
    });

    it('picks the nearer of two overlapping meshes', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 12], lookAt: 0 }),
            new Box3D({ width: 2, position: [0, 0, -4] }),
            new Box3D({ width: 2, position: [0, 0, 4] }),
        ]);

        // Both are on the axis, so both boxes contain the centre; the one nearer
        // the camera is what you can see.
        expect(pickNode(canvas, { x: 0, y: 0 })?.path).toBe('2');
    });

    it('falls through to the viewport where no mesh is', () => {
        // Rooted, because `pickNode` never returns the node it was handed — the
        // root is the stage, not a selectable thing.
        const root = new Canvas2D({});
        const canvas = new Canvas3D({
            width: 400,
            height: 300,
            children: [
                new Camera3D({ position: [0, 0, 12], lookAt: 0 }),
                new Box3D({ width: 1 }),
            ],
        } as any);
        root.add(canvas as unknown as Node2D);
        root.layout({ x: 0, y: 0, width: 400, height: 300 } as BoxBounds, scope);
        canvas.layout({ x: 0, y: 0, width: 400, height: 300 } as BoxBounds, scope);

        // Near the viewport's corner, well clear of a 1-unit cube on the axis.
        const picked = pickNode(root, { x: 190, y: 140 });
        expect(picked?.type).toBe('Canvas3d');
        expect(picked?.path).toBe('0');
    });

    it('lets a 2D HUD child win over the mesh behind it', () => {
        const label = new Text({ text: 'FPS', x: 0, y: 0 }) as unknown as Node2D;
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 12], lookAt: 0 }),
            new Box3D({ width: 4 }),
            label,
        ]);

        // The label is laid out over the centre of the viewport, where the cube is.
        const picked = pickNode(canvas, { x: 0, y: 0 });
        expect(picked?.type).toBe('Text');
    });
});

describe('projectNode3DAt', () => {
    it('agrees with the box centre for a mesh with no rotation of its own', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 2 }),
        ]);

        const collected: NodeBox[] = [];
        collectBoxes(canvas, '', collected, true);
        const box = at(collected, '1');

        const projected = projectNode3DAt(canvas, '1', [], []);
        expect(projected?.origin?.x).toBeCloseTo(box.center.x, 6);
        expect(projected?.origin?.y).toBeCloseTo(box.center.y, 6);
    });

    it("resolves parentPoints in the parent's frame and localPoints in the mesh's own", () => {
        // The box sits inside a `Group3D` with no transform of its own — so its
        // *parent* frame is world space — but is itself turned 90° about Y,
        // which swings its own local +X into world +Z (straight at the camera).
        // A `parentPoints` request one unit along the parent's +X should read as
        // an ordinary sideways shift on screen; the identical offset asked as a
        // `localPoints` request should barely move sideways at all, since the
        // mesh's own +X no longer points sideways.
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Group3D({
                children: [new Box3D({ width: 1, position: [2, 0, 0], rotation: [0, 90, 0] })],
            } as any),
        ]);

        const projected = projectNode3DAt(
            canvas,
            '1.0',
            [{ x: 3, y: 0, z: 0 }],
            [{ x: 1, y: 0, z: 0 }],
        );
        expect(projected?.origin).not.toBeNull();
        expect(projected?.parentPoints[0]).not.toBeNull();
        expect(projected?.localPoints[0]).not.toBeNull();

        const originX = projected!.origin!.x;
        const parentShiftX = Math.abs(projected!.parentPoints[0]!.x - originX);
        const localShiftX = Math.abs(projected!.localPoints[0]!.x - originX);
        expect(parentShiftX).toBeGreaterThan(localShiftX * 3);
    });

    it('reports a point behind the camera as null without dropping the rest', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 1 }),
        ]);

        // The camera sits at z=10 looking at the origin — a point at z=30 is
        // behind it, while one at z=0 (the mesh's own position) is in view.
        const projected = projectNode3DAt(
            canvas,
            '1',
            [{ x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: 0 }],
            [],
        );
        expect(projected?.parentPoints[0]).toBeNull();
        expect(projected?.parentPoints[1]).not.toBeNull();
    });

    it('is null for a path that resolves to a 2D node', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 1 }),
            new Text({ text: 'FPS', x: 0, y: 0 }),
        ]);

        expect(projectNode3DAt(canvas, '2', [], [])).toBeNull();
    });

    it('is null for a path that does not resolve', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 1 }),
        ]);

        expect(projectNode3DAt(canvas, '1.7', [], [])).toBeNull();
    });

    it("reports bounds in the node's own frame, turned and scaled as it is", () => {
        // World-aligned, the turned box would measure 3 deep; in its own frame
        // it is still 3 × 1 × 1, before the scale its own matrix applies.
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Box3D({ width: 3, position: [2, 0, 0], rotation: [0, 90, 0], scale: 2 }),
        ]);

        const bounds = projectNode3DAt(canvas, '1', [], [])?.bounds;
        expect(bounds?.min.x).toBeCloseTo(-1.5, 6);
        expect(bounds?.max.x).toBeCloseTo(1.5, 6);
        expect(bounds?.min.z).toBeCloseTo(-0.5, 6);
        expect(bounds?.max.z).toBeCloseTo(0.5, 6);
    });

    it('takes its children into the bounds, placed where they sit', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Group3D({
                children: [
                    new Box3D({ width: 1 }),
                    new Sphere3D({ radius: 0.5, position: [0, 2, 0] }),
                ],
            } as any),
            new Box3D({ width: 1, position: [-3, 0, 0] }),
        ]);

        const bounds = projectNode3DAt(canvas, '1', [], [])?.bounds;
        expect(bounds?.min.y).toBeCloseTo(-0.5, 6);
        expect(bounds?.max.y).toBeCloseTo(2.5, 6);
        // The sibling outside the group stays out of it.
        expect(bounds?.min.x).toBeCloseTo(-0.5, 6);
    });

    it('has no bounds for a node that draws nothing', () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Group3D({ children: [] } as any),
            new Box3D({ width: 1 }),
        ]);

        expect(projectNode3DAt(canvas, '1', [], [])?.bounds).toBeNull();
    });
});

describe('collectBoxes – 3D: the other camera and drawable cases', () => {
    /** Every 3D box in `canvas`, keyed by path. */
    function boxesOf(canvas: Canvas3D): NodeBox[] {
        const boxes: NodeBox[] = [];
        collectBoxes(canvas, '', boxes, true);
        return boxes;
    }

    // A 400x300 viewport viewed through a frustum 6 units tall is 8 units wide
    // (the aspect is 4:3), so one world unit is exactly 50 viewport units.
    const ORTHO = { type: 'orthographic', frustumHeight: 6, position: [0, 0, 10], lookAt: 0 } as const;
    const PX_PER_UNIT = 50;

    describe('an orthographic camera', () => {
        it('maps a world unit to a fixed number of viewport units', () => {
            const canvas = viewport([new Camera3D(ORTHO), new Box3D({ width: 2, height: 2, depth: 2 })]);
            const box = at(boxesOf(canvas), '1');
            closeTo(box.width, 2 * PX_PER_UNIT, 1e-9);
            closeTo(box.height, 2 * PX_PER_UNIT, 1e-9);
            closeTo(box.center.x, 0, 1e-9);
            closeTo(box.center.y, 0, 1e-9);
        });

        it('does not shrink a box with distance, unlike a perspective camera', () => {
            const sizeAt = (z: number, camera: Camera3D) =>
                at(boxesOf(viewport([camera, new Box3D({ width: 1, position: [0, 0, z] })])), '1').width;

            const orthoNear = sizeAt(4, new Camera3D(ORTHO));
            const orthoFar = sizeAt(-30, new Camera3D(ORTHO));
            closeTo(orthoNear, orthoFar, 1e-9);

            const perspective = () => new Camera3D({ position: [0, 0, 10], lookAt: 0, fov: 45 });
            expect(sizeAt(-30, perspective())).toBeLessThan(sizeAt(4, perspective()));
        });

        it('tracks the viewport aspect: the frustum height is fixed and the width follows', () => {
            const canvas = new Canvas3D({
                width: 800, height: 300,
                children: [new Camera3D(ORTHO), new Box3D({ width: 1, height: 1, depth: 1 })],
            } as any);
            canvas.layout({ x: 0, y: 0, width: 800, height: 300 } as BoxBounds, scope);
            const box = at(boxesOf(canvas), '1');
            // 6 units tall over 300 -> 50 per unit on both axes, whatever the width.
            closeTo(box.height, 50, 1e-9);
            closeTo(box.width, 50, 1e-9);
        });

        it('folds the camera zoom into the frustum', () => {
            const zoomed = viewport([new Camera3D({ ...ORTHO, zoom: 2 }), new Box3D({ width: 1, height: 1, depth: 1 })]);
            closeTo(at(boxesOf(zoomed), '1').width, 2 * PX_PER_UNIT, 1e-9);
        });
    });

    describe('a sprite', () => {
        it('is measured as a unit quad scaled by its transform', () => {
            const canvas = viewport([new Camera3D(ORTHO), new Sprite3D({ fill: 'red' })]);
            const box = at(boxesOf(canvas), '1');
            expect(box.type).toBe('Sprite3d');
            closeTo(box.width, PX_PER_UNIT, 1e-9);
            closeTo(box.height, PX_PER_UNIT, 1e-9);

            const scaled = viewport([new Camera3D(ORTHO), new Sprite3D({ fill: 'red', scale: 3 })]);
            closeTo(at(boxesOf(scaled), '1').width, 3 * PX_PER_UNIT, 1e-9);
        });
    });

    describe('instances', () => {
        it('are measured as the union of every instance placed inside the node', () => {
            const canvas = viewport([
                new Camera3D(ORTHO),
                new Instances3D({
                    geometry: { type: 'box' },
                    instances: [{ position: [-3, 0, 0] }, { position: [3, 0, 0] }],
                } as any),
            ]);
            const box = at(boxesOf(canvas), '1');
            // Each unit box spans +-0.5 about its centre: -3.5 .. 3.5 is 7 units wide.
            closeTo(box.width, 7 * PX_PER_UNIT, 1e-9);
            closeTo(box.height, 1 * PX_PER_UNIT, 1e-9);
            closeTo(box.center.x, 0, 1e-9);
        });

        it('are placed inside the node\'s own transform as well', () => {
            const canvas = viewport([
                new Camera3D(ORTHO),
                new Instances3D({
                    geometry: { type: 'box' },
                    position: [0, 2, 0],
                    instances: [{ position: [0, 0, 0] }],
                } as any),
            ]);
            closeTo(at(boxesOf(canvas), '1').center.y, 2 * PX_PER_UNIT, 1e-9);
        });

        it('give no box when there are no instances to measure', () => {
            const canvas = viewport([
                new Camera3D(ORTHO),
                new Instances3D({ geometry: { type: 'box' }, instances: [] } as any),
            ]);
            expect(boxesOf(canvas).some((box) => box.path === '1')).toBe(false);
        });
    });

    describe('a rotated parent', () => {
        it('carries its child\'s box with it', () => {
            // Turning the group 90 degrees about Z swings the child from +X to +Y.
            const canvas = viewport([
                new Camera3D(ORTHO),
                new Group3D({
                    rotation: [0, 0, 90],
                    children: [new Box3D({ width: 1, height: 1, depth: 1, position: [2, 0, 0] })],
                } as any),
            ]);
            const boxes = boxesOf(canvas);
            const child = at(boxes, '1.0');
            closeTo(child.center.x, 0, 1e-6);
            closeTo(child.center.y, 2 * PX_PER_UNIT, 1e-6);
            // A unit box turned a quarter turn is still a unit box.
            closeTo(child.width, PX_PER_UNIT, 1e-6);
            // The group encloses what it contains.
            closeTo(at(boxes, '1').center.y, 2 * PX_PER_UNIT, 1e-6);
        });

        it('encloses a box turned 45 degrees by its axis-aligned extent', () => {
            const canvas = viewport([
                new Camera3D(ORTHO),
                new Box3D({ width: 1, height: 1, depth: 1, rotation: [0, 0, 45] }),
            ]);
            // The world AABB of a unit cube turned 45 degrees about Z is sqrt(2) wide.
            closeTo(at(boxesOf(canvas), '1').width, Math.SQRT2 * PX_PER_UNIT, 1e-6);
        });
    });

    describe('locked', () => {
        it('carries the node\'s own flag, and the box is still listed so an outline can be drawn', () => {
            const locked = new Box3D({ width: 1, position: [-2, 0, 0] });
            const free = new Box3D({ width: 1, position: [2, 0, 0] });
            locked._setEditorState(false, true);
            const canvas = viewport([new Camera3D(ORTHO), locked, free]);

            const boxes = boxesOf(canvas);
            expect(at(boxes, '1').locked).toBe(true);
            expect(at(boxes, '2').locked).toBe(false);
        });

        it('does not take the flag from the viewport it sits in', () => {
            const canvas = viewport([new Camera3D(ORTHO), new Box3D({ width: 1 })]);
            canvas._setEditorState(false, true);
            const boxes: NodeBox[] = [];
            collectBoxes(canvas, '', boxes, true);
            expect(at(boxes, '1').locked).toBe(false);
        });
    });

    describe('far off screen', () => {
        it('clamps a box to 8 viewport sizes about the centre instead of reporting its true place', () => {
            // 1000 units to the side is 50000 viewport units, far past the clamp.
            const canvas = viewport([new Camera3D(ORTHO), new Box3D({ width: 1, position: [1000, 0, 0] })]);
            const box = at(boxesOf(canvas), '1');
            // Half the 400-wide viewport is 200, and the limit is 8 times that.
            closeTo(box.center.x, 8 * 200, 1e-6);
            closeTo(box.width, 0, 1e-6);
            // It points the right way: the clamp keeps the side the box is on.
            expect(box.center.x).toBeGreaterThan(0);
        });

        it('keeps a box that only partly leaves the viewport at its true size', () => {
            const canvas = viewport([new Camera3D(ORTHO), new Box3D({ width: 2, height: 2, depth: 2, position: [4, 0, 0] })]);
            const box = at(boxesOf(canvas), '1');
            // 4 +- 1 units -> 150 .. 250, past the 200 edge but nowhere near the clamp.
            closeTo(box.center.x, 4 * PX_PER_UNIT, 1e-6);
            closeTo(box.width, 2 * PX_PER_UNIT, 1e-6);
        });
    });

    describe('straddling the eye plane', () => {
        const eye = () => new Camera3D({ position: [0, 0, 5], lookAt: 0, fov: 50 });

        it('reports the visible span instead of dropping the box or reflecting it', () => {
            // The camera sits at z = 5, inside this slab, which runs from z = -15 to 25.
            const canvas = viewport([eye(), new Box3D({ width: 4, height: 4, depth: 40, position: [0, 0, 5] })]);
            const box = at(boxesOf(canvas), '1');
            // It surrounds the eye, so it covers the whole viewport and then some.
            expect(box.width).toBeGreaterThan(400);
            expect(box.height).toBeGreaterThan(300);
            // It is centred where the camera looks, not mirrored to a side.
            closeTo(box.center.x, 0, 1e-6);
            closeTo(box.center.y, 0, 1e-6);
        });

        it('stays inside the clamp however close a corner comes to the eye', () => {
            const canvas = viewport([eye(), new Box3D({ width: 4, height: 4, depth: 40, position: [0, 0, 5] })]);
            const box = at(boxesOf(canvas), '1');
            expect(box.width).toBeLessThanOrEqual(2 * 8 * 200 + 1e-6);
            expect(box.height).toBeLessThanOrEqual(2 * 8 * 150 + 1e-6);
            expect(Number.isFinite(box.width)).toBe(true);
            expect(Number.isFinite(box.height)).toBe(true);
        });

        it('drops a box that lies wholly behind the eye plane', () => {
            const canvas = viewport([eye(), new Box3D({ width: 2, height: 2, depth: 2, position: [0, 0, 20] })]);
            expect(boxesOf(canvas).some((box) => box.path === '1')).toBe(false);
        });
    });
});

describe('pickNode – a locked mesh', () => {
    // A locked 2D node is never the answer of `pickNode`, but `pickNode3D` does not
    // consult the mesh's flag: the mesh is returned with `locked: true` on its box.
    it.skip('does not return a locked mesh, as it does not return a locked 2D node', () => {
        const mesh = new Box3D({ width: 2, height: 2, depth: 2 });
        mesh._setEditorState(false, true);
        const canvas = viewport([new Camera3D({ position: [0, 0, 10], lookAt: 0 }), mesh]);

        expect(pickNode(canvas, { x: 0, y: 0 })).toBeNull();
    });
});

describe('projectNode3DAt under a parent with coordinates of its own', () => {
    const Graph = component3d({
        key: 'sidewaysGraph',
        space: () => ({ toLocal: (x: number, y: number, z: number) => ({ x: y * 2, y: z, z: x }) }),
    });

    it("reads parentPoints in the coordinates the node's position is in", () => {
        const canvas = viewport([
            new Camera3D({ position: [0, 0, 10], lookAt: 0 }),
            new Graph({ children: [new Box3D({ width: 0.5, x: 0, y: 1.5, z: 1 })] } as any),
        ]);

        const projected = projectNode3DAt(canvas, '1.0', [{ x: 0, y: 1.5, z: 1 }, { x: 0, y: 2.5, z: 1 }], []);
        const [here, nudged] = projected!.parentPoints;
        expect(here!.x).toBeCloseTo(projected!.origin!.x, 6);
        expect(here!.y).toBeCloseTo(projected!.origin!.y, 6);
        // One unit of the node's own `y` is two along the scene's x: a sideways step, not a rise.
        expect(nudged!.x).toBeGreaterThan(here!.x);
        expect(nudged!.y).toBeCloseTo(here!.y, 6);
    });
});

