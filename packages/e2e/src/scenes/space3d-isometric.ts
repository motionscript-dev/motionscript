import { Rect } from '@motionscript/sdk';
import { easeInOut, el, scene, stageCommand } from '../doc';
import { holdTail } from './_lib';

const TILES = [
    { x: -180, y: 180, height: 40, fill: '#e0533d' },
    { x: 0, y: 180, height: 120, fill: '#f2c14e' },
    { x: 180, y: 180, height: 70, fill: '#4fb286' },
    { x: -180, y: 0, height: 150, fill: '#3d6fe0' },
    { x: 0, y: 0, height: 20, fill: '#9b5de5' },
    { x: 180, y: 0, height: 100, fill: '#f15bb5' },
    { x: -180, y: -180, height: 90, fill: '#00bbf9' },
    { x: 0, y: -180, height: 60, fill: '#fee440' },
    { x: 180, y: -180, height: 130, fill: '#00f5d4' },
];

/**
 * A parallel projection: `perspective: 0` with the textbook isometric angles.
 * A floor is laid down with `rotationX: 90`, and its tiles' `depth` is their
 * height above it. The orbit turns the view a quarter round, so the tiles
 * re-sort as their order toward the camera changes.
 */
export default scene((stage) => {
    stage.set({ fill: '#101318', space3D: true, perspective: 0, orbit: 45, elevation: 35.26 });
    stage.add(
        el(Rect, { width: 640, height: 640, rotationX: 90, cornerRadius: 24, fill: '#1c2230', children: [
            TILES.map((t) => el(Rect, { width: 150, height: 150, cornerRadius: 12, x: t.x, y: t.y, depth: t.height, fill: t.fill })),
        ] }),
    );
}, [
    () => stageCommand('orbitTo', { orbit: 135 }, 1.6, easeInOut('cubic')),
    holdTail(1.6),
]);
