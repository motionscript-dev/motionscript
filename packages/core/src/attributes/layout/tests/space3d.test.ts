import { describe, it, expect } from 'vitest';
import {
    applyToPoint, cameraMatrix, multiply, nodeLocalMatrix, nodeProjectedMatrix, NO_PROJECTION_3D,
    type Matrix2D, type Projection3D,
} from '@/attributes/layout/matrix2d';
import {
    cameraSide, lerpLookAt, multiplyAffine3, nearCoverage, nearCutPolygon, nodeSpaceMatrix,
    space3dOps, spacePaintOrder, spacePlane, spaceScreenMatrix, spaceViewMatrix, type SpaceCamera,
} from '@/attributes/layout/space3d';
import { resolveCameraPlacement } from '@/render3d/camera';

function closeTo(a: number, b: number, eps = 1e-9): void {
    expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
}

function camera(overrides: Partial<SpaceCamera> = {}): SpaceCamera {
    return {
        perspective: 1000, orbit: 0, elevation: 0, dolly: 0,
        lookAt: { x: 0, y: 0 }, zoom: 1, heading: 0,
        viewportX: 0, viewportY: 0,
        ...overrides,
    };
}

function p3(overrides: Partial<Projection3D> = {}): Projection3D {
    return { ...NO_PROJECTION_3D, ...overrides };
}

/** Screen position of local point `(u, v)` (canvas, y-down) of a node placed by `local` in the root. */
function project(cam: SpaceCamera, local: readonly number[], u = 0, v = 0) {
    const screen = spaceScreenMatrix(cam, multiplyAffine3(spaceViewMatrix(cam), local));
    return applyToPoint(screen, { x: u, y: v });
}

function sameMapping(a: Matrix2D, b: Matrix2D): void {
    for (const pt of [{ x: 0, y: 0 }, { x: 120, y: -40 }, { x: -75, y: 90 }, { x: 33, y: 17 }]) {
        const pa = applyToPoint(a, pt), pb = applyToPoint(b, pt);
        closeTo(pa.x, pb.x, 1e-6);
        closeTo(pa.y, pb.y, 1e-6);
    }
}

describe('space3d – agreement with the flat and per-node paths', () => {
    it('a lone node on the camera axis projects exactly as nodeProjectedMatrix does', () => {
        const proj = p3({ rotationX: 25, rotationY: -40, rotationZ: 10, depth: 120 });
        const cam = camera({ perspective: 900 });
        const space = spaceScreenMatrix(cam, multiplyAffine3(spaceViewMatrix(cam), nodeSpaceMatrix(0, 0, 15, 1.3, 0, 0, proj)));
        sameMapping(space, nodeProjectedMatrix(0, 0, 15, 1.3, 0, 0, { ...proj, perspective: 900 }));
    });

    it('at rest it is the 2D camera times the flat local matrix', () => {
        const cam = camera({ perspective: 800, lookAt: { x: 30, y: -20 }, zoom: 1.5, heading: 10, viewportX: 4, viewportY: -6 });
        const local = nodeSpaceMatrix(140, -60, 30, 0.8, 12, -9, p3());
        const space = spaceScreenMatrix(cam, multiplyAffine3(spaceViewMatrix(cam), local));
        const flat = multiply(cameraMatrix(4, -6, { x: 30, y: -20 }, 1.5, 10), nodeLocalMatrix(140, -60, 30, 0.8, 12, -9));
        for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) closeTo(space[k], flat[k], 1e-9);
        closeTo(space.g ?? 0, 0);
        closeTo(space.h ?? 0, 0);
        closeTo(space.i ?? 1, 1);
    });

    it('a parallel projection stays affine', () => {
        const cam = camera({ perspective: 0, orbit: 45, elevation: 35.26 });
        const screen = spaceScreenMatrix(cam, multiplyAffine3(spaceViewMatrix(cam), nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3({ depth: 300 }))));
        expect(screen.g).toBeUndefined();
        expect(screen.i).toBeUndefined();
    });
});

describe('space3d – camera', () => {
    it('panning moves far layers less than near ones', () => {
        const cam = camera({ perspective: 1000, lookAt: { x: 300, y: 0 } });
        closeTo(project(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3())).x, -300);
        closeTo(project(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3({ depth: -2000 }))).x, -100);
    });

    it('dolly pushes the camera in: half the distance is twice the size', () => {
        const cam = camera({ perspective: 1000, dolly: 500 });
        closeTo(project(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3()), 100, 0).x, 200);
    });

    it('lookAt.z moves the focus in depth', () => {
        const cam = camera({ perspective: 1000, lookAt: { x: 0, y: 0, z: -800 } });
        closeTo(project(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3({ depth: -800 })), 100, 0).x, 100);
    });

    it('orbit and elevation place the camera where Camera3D places it', () => {
        for (const [orbit, elevation] of [[0, 0], [90, 0], [-35, 20], [140, -60]]) {
            const view = spaceViewMatrix(camera({ orbit, elevation }));
            const { position } = resolveCameraPlacement({ type: 'perspective', orbit, elevation, distance: 1 });
            // The view's third row is the direction from the target to the camera,
            // in the root's y-down frame; Camera3D's world is y-up.
            closeTo(view[8], position.x, 1e-9);
            closeTo(view[9], -position.y, 1e-9);
            closeTo(view[10], position.z, 1e-9);
        }
    });

    it('a positive orbit swings the near side of the scene to the left of frame', () => {
        const cam = camera({ orbit: 90 });
        expect(project(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3({ depth: 100 }))).x).toBeLessThan(-1);
    });

    it('a positive elevation looks down: the near side drops lower in frame', () => {
        const cam = camera({ elevation: 30 });
        expect(project(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3({ depth: 100 }))).y).toBeGreaterThan(1);
    });

    it('heading rolls and zoom magnifies after the projection', () => {
        const cam = camera({ zoom: 2, heading: 90 });
        const p = project(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3()), 50, 0);
        closeTo(p.x, 0, 1e-9);
        closeTo(p.y, -100, 1e-9);
    });
});

describe('space3d – planes', () => {
    const box = { x: 0, y: 0, width: 200, height: 100 };
    const planeOf = (cam: SpaceCamera, local: readonly number[]) =>
        spacePlane(multiplyAffine3(spaceViewMatrix(cam), local), box);

    it('orbiting half way round shows the back of an unturned node', () => {
        expect(cameraSide(camera(), planeOf(camera(), nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3()))).side).toBeGreaterThan(0);
        const behind = camera({ orbit: 180 });
        expect(cameraSide(behind, planeOf(behind, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3()))).side).toBeLessThan(0);
    });

    it('a mirror is not a back face', () => {
        const cam = camera();
        const flipped = planeOf(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3({ flipHorizontal: true })));
        expect(cameraSide(cam, flipped).side).toBeGreaterThan(0);
    });

    it('a node the camera has flown past is not drawn, and one it is flying through is cut', () => {
        const cam = camera({ perspective: 1000, lookAt: { x: 0, y: 0, z: -1500 } });
        expect(nearCoverage(cam, planeOf(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3())))).toBe('none');
        expect(nearCoverage(cam, planeOf(cam, nodeSpaceMatrix(0, 0, 0, 1, 0, 0, p3({ depth: -1800 }))))).toBe('all');

        // A floor running from far behind the lens to far in front of it.
        const floorCam = camera({ perspective: 1000 });
        const floor = nodeSpaceMatrix(0, 200, 0, 1, 0, 0, p3({ rotationX: 90 }));
        const tall = { x: 0, y: 0, width: 400, height: 6000 };
        expect(nearCoverage(floorCam, spacePlane(multiplyAffine3(spaceViewMatrix(floorCam), floor), tall))).toBe('some');
        const view = multiplyAffine3(spaceViewMatrix(floorCam), floor);
        const cut = nearCutPolygon(spaceScreenMatrix(floorCam, view), tall, 0);
        expect(cut).not.toBeNull();
        for (const p of cut!) {
            const s = spaceScreenMatrix(floorCam, view);
            expect((s.g ?? 0) * p.x + (s.h ?? 0) * p.y + (s.i ?? 1)).toBeGreaterThan(0.0099);
        }
    });
});

describe('space3d – paint order', () => {
    const box = { x: 0, y: 0, width: 300, height: 200 };
    const planeAt = (cam: SpaceCamera, local: readonly number[]) =>
        spacePlane(multiplyAffine3(spaceViewMatrix(cam), local), box);

    it('parallel layers paint far to near whatever order they were authored in', () => {
        const cam = camera({ orbit: 25 });
        const depths = [200, -600, 0, -1200];
        const planes = depths.map((depth, i) => planeAt(cam, nodeSpaceMatrix(i * 40, 0, 0, 1, 0, 0, p3({ depth }))));
        expect(spacePaintOrder(cam, planes)).toEqual([3, 1, 2, 0]);
    });

    it('coplanar siblings keep their authored order under an orbit', () => {
        const cam = camera({ orbit: 30, elevation: 10 });
        const planes = [-300, 0, 300].map(x => planeAt(cam, nodeSpaceMatrix(x, 0, 0, 1, 0, 0, p3())));
        expect(spacePaintOrder(cam, [...planes].reverse())).toEqual([0, 1, 2]);
        expect(spacePaintOrder(cam, planes)).toEqual([0, 1, 2]);
    });

    it('a ring of cards paints its front card last', () => {
        const cam = camera({ perspective: 1000 });
        const angles = [0, 60, 120, 180, 240, 300];
        const planes = angles.map(a => {
            const rad = a * Math.PI / 180;
            return planeAt(cam, nodeSpaceMatrix(420 * Math.sin(rad), 0, 0, 1, 0, 0, p3({ depth: 420 * Math.cos(rad), rotationY: a })));
        });
        const order = spacePaintOrder(cam, planes);
        expect(order[order.length - 1]).toBe(0);
        // The back card lies behind both near side cards' planes. Where the plane
        // test has no opinion (cards that cannot overlap), any order is right.
        expect(order.indexOf(3)).toBeLessThan(order.indexOf(1));
        expect(order.indexOf(3)).toBeLessThan(order.indexOf(5));
    });
});

describe('space3d – host ops', () => {
    const props = { perspective: 900, orbit: 30, elevation: 15, dolly: 200, lookAt: { x: 40, y: -20, z: -300 }, zoom: 1.4, heading: 20 };

    it('projects a scene point where the renderer draws it', () => {
        const cam = camera(props);
        const at = project(cam, nodeSpaceMatrix(120, -80, 0, 1, 0, 0, p3({ depth: -150 })));
        const p = space3dOps.project(props, { x: 120, y: 80, z: -150 })!;
        closeTo(p.x, at.x, 1e-9);
        closeTo(p.y, -at.y, 1e-9);
    });

    it('turns a picture drag back into the move at the focus that made it', () => {
        const f = space3dOps.focusVector(props, { x: 35, y: -12 });
        const moved = space3dOps.project(props, { x: 40 + f.x, y: -20 + f.y, z: -300 + f.z })!;
        closeTo(moved.x, 35, 1e-9);
        closeTo(moved.y, -12, 1e-9);
    });

    it('answers nothing for a point behind the lens', () => {
        expect(space3dOps.project(props, { x: 0, y: 0, z: 2000 })).toBeNull();
    });
});

describe('space3d – lookAt', () => {
    it('lerps without inventing a z', () => {
        expect(lerpLookAt({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
        expect(lerpLookAt({ x: 0, y: 0 }, { x: 0, y: 0, z: -100 }, 0.25)).toEqual({ x: 0, y: 0, z: -25 });
    });
});
