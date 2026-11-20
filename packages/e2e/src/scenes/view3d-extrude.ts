import { Canvas3D, Extrude3D } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Two outlines swept into solids: a star with rounded rims, and a square with a
 * round hole through it. Covers the cap triangulation (a concave outline, a
 * hole bridged into its outline), the walls creased at the corners and smooth
 * round the curve, and the bevel rings, all evaluated in core and drawn as a
 * buffer.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Canvas3D, {
            width: 640, height: 400, cornerRadius: 16, orbit: 60, elevation: 25, zoom: 7,
            children: [
                el(Extrude3D, {
                    x: -1.4,
                    path: 'M 0 1 L 0.26 0.36 L 0.95 0.31 L 0.43 -0.14 L 0.59 -0.81 L 0 -0.45 L -0.59 -0.81 L -0.43 -0.14 L -0.95 0.31 L -0.26 0.36 Z',
                    depth: 0.3,
                    bevel: { size: 0.06, thickness: 0.06, segments: 3 },
                    fill: '#f2b33d',
                    roughness: 0.5,
                }),
                el(Extrude3D, {
                    x: 1.4,
                    path: 'M -0.9 -0.9 L 0.9 -0.9 L 0.9 0.9 L -0.9 0.9 Z M 0.5 0 A 0.5 0.5 0 1 0 -0.5 0 A 0.5 0.5 0 1 0 0.5 0 Z',
                    depth: 0.5,
                    segments: 16,
                    fill: '#3b6fd6',
                    roughness: 0.6,
                }),
            ],
        }),
    );
}, [holdTail(1)]);
