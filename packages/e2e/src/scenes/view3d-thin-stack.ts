import { Canvas3D, Camera3D, AmbientLight3D, DirectionalLight3D, Box3D, Group3D } from '@motionscript/sdk';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * Thin parts close together, seen from about 20 units away: a plate lifted
 * 0.002 off a base, grid bars 0.002 above the plate, and beams whose faces sit
 * 0.001 inside a slab. With standard-Z depth the bars vanish over the plate
 * and the beams stripe through the slab.
 */
const TOP = 0.1;

export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('spin', 0);

    const bars = [-3, -2.25, -1.5, -0.75, 0.75, 1.5, 2.25, 3].map((x) =>
        el(Box3D, { width: 0.05, height: 0.001, depth: 5.6, position: [x, TOP + 0.0035, 0], fill: '#1f2430' }),
    );

    stage.add(
        el(Canvas3D, { width: 900, height: 500, cornerRadius: 16, children: [
            el(Camera3D, { position: [0, 11, 17], target: [0, 0.3, 0], fov: 22 }),
            el(AmbientLight3D, { intensity: 0.6 }),
            el(DirectionalLight3D, { intensity: 2, position: [4, 9, 5] }),
            el(Group3D, { rotation: [0, '=[spin]', 0] as never, children: [
                el(Box3D, { width: 8, height: TOP * 2, depth: 6, fill: '#d9d4c7' }),
                el(Box3D, { width: 3.6, height: 0.001, depth: 2.4, position: [0, TOP + 0.0015, 0], fill: '#3b6fd6' }),
                ...bars,
                el(Box3D, { width: 3, height: 0.024, depth: 2, position: [-1.6, 1, 0], fill: '#e8e2d4' }),
                ...[-0.6, 0, 0.6].map((z) =>
                    el(Box3D, { width: 3.2, height: 0.022, depth: 0.2, position: [-1.6, 1, z], fill: '#c0392b' }),
                ),
            ] }),
        ] }),
    );
}, [
    () => variableTo('spin', 25, 1.4, easeInOut('quad')),
    holdTail(1.4),
]);
