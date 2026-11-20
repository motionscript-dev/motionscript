import { Canvas3D } from '@motionscript/sdk';
import { easeInOut, el, scene, variableTo } from '../doc';
import { PanelPlane3D } from '@/components/view3d';
import { holdTail } from './_lib';

/**
 * 2D-on-3D: a `Tex.surface` bound to a material map.
 *
 * The other direction of the bridge, and the one with the most machinery behind
 * it — the 2D source is rasterized to an offscreen buffer during preflight, read
 * back, and uploaded as a texture before the 3D scene syncs, so that a scrubbed
 * frame carries the same pixels a played one would.
 *
 * The source is hoisted out of the scene on purpose (see `PanelPlane3D`).
 * Rebuilding it per frame would re-lay-out every frame, defeat the texture cache
 * and leak — a mistake worth having a regression test sit on.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('spin', -25);

    stage.add(
        el(Canvas3D, {
            width: 480, height: 320,
            orbit: 90, elevation: 0, zoom: 4.2, fov: 45,
            lights: [{ type: 'ambient', intensity: 0.8 }, { type: 'sun', intensity: 1.6, orbit: 63.4349, elevation: 33.8545 }],
            children: [
                el(PanelPlane3D, { width: 3, height: 3, rotation: [0, '=[spin]', 0] as never }),
            ],
        }),
    );
}, [
    () => variableTo('spin', 25, 1.4, easeInOut('quad')),
    holdTail(1.4),
]);
