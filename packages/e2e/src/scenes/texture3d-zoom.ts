import { Canvas3D, Box3D } from '@motionscript/sdk';
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
        el(Canvas3D, {
            width: 480, height: 320, cornerRadius: 16,
            orbit: 90, elevation: 0, zoom: 5, fov: '=[fov]' as never,
            lights: [{ type: 'ambient', intensity: 1.2 }, { type: 'sun', intensity: 0.8, orbit: 75.9638, elevation: 25.8767 }],
            children: [
                el(Box3D, { width: 3, height: 2, depth: 0.05, fill: 'kingfisher.jpg', roughness: 1 }),
            ],
        }),
    );
}, [
    () => variableTo('fov', 8, 1.4, easeInOut('quad')),
    holdTail(1.4),
]);
