import { Canvas3D, Camera3D, AmbientLight3D, DirectionalLight3D, Box3D } from '@motionscript/sdk';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * An image-mapped surface the camera narrows in on. The texture's decode is
 * sized from the 3D buffer, so as the field of view closes the map is uploaded
 * again at a higher level rather than magnified.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('fov', 60);

    stage.add(
        el(Canvas3D, { width: 480, height: 320, cornerRadius: 16, children: [
            el(Camera3D, { position: [0, 0, 5], target: 0, fov: '=[fov]' as never }),
            el(AmbientLight3D, { intensity: 1.2 }),
            el(DirectionalLight3D, { intensity: 0.8, position: [1, 2, 4] }),
            el(Box3D, { width: 3, height: 2, depth: 0.05, fill: 'kingfisher.jpg', roughness: 1 }),
        ] }),
    );
}, [
    () => variableTo('fov', 8, 1.4, easeInOut('quad')),
    holdTail(1.4),
]);
