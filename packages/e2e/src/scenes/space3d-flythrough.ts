import { Rect } from '@motionscript/sdk';
import { easeInOut, el, scene, stageCommand } from '../doc';
import { holdTail } from './_lib';

const FRAMES = ['#e0533d', '#f2c14e', '#4fb286', '#3d6fe0', '#9b5de5'];
const MARKERS = [-1800, -1350, -900, -450, 0, 450, 900, 1350, 1800];

/**
 * Flying through the layers by moving `lookAt` in depth. Frames the camera has
 * passed stop drawing rather than flipping round behind it, and the floor the
 * camera passes over is cut at the lens while the rest of it runs on ahead.
 */
export default scene((stage) => {
    stage.set({ fill: '#07080c', space3D: true, perspective: 900 });
    stage.add([
        el(Rect, { width: 900, height: 4000, y: -300, rotationX: 90, depth: -1400, fill: '#161b26', children: [
            MARKERS.map((y) => el(Rect, { width: 40, height: 200, y, fill: 'white/35' })),
        ] }),
        ...FRAMES.map((color, i) => el(Rect, {
            width: 900,
            height: 520,
            cornerRadius: 30,
            depth: -700 * i,
            stroke: { weight: 16, fill: color },
        })),
    ]);
}, [
    () => stageCommand('panTo', { lookAt: { x: 0, y: 0, z: -2300 } }, 1.8, easeInOut('sine')),
    holdTail(1.8),
]);
