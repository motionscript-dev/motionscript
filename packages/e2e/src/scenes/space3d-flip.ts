import { Ellipse, Rect } from '@motionscript/sdk';
import { easeInOut, el, scene, stageCommand } from '../doc';
import { holdTail } from './_lib';

/**
 * A card's back revealed by the camera, not by turning the card: two faces back
 * to back, each hiding while it faces away, and the stage orbiting half way
 * round. The back face's dot goes with it — a hidden face hides its subtree.
 * The bar behind the card swings the other way across the frame, so the orbit
 * reads as the camera moving rather than the card.
 */
export default scene((stage) => {
    stage.set({ fill: '#10131a', space3D: true, perspective: 900 });
    stage.add([
        el(Rect, { width: 700, height: 50, y: -170, cornerRadius: 25, fill: '#2a3345', depth: -240 }),
        el(Rect, { width: 300, height: 420, children: [
            el(Rect, { width: 300, height: 420, cornerRadius: 24, fill: '#3d6fe0', backfaceVisible: false }),
            el(Rect, {
                width: 300,
                height: 420,
                cornerRadius: 24,
                fill: '#e0533d',
                rotationY: 180,
                backfaceVisible: false,
                children: [
                    el(Ellipse, { width: 120, height: 120, fill: 'white' }),
                ],
            }),
        ] }),
    ]);
}, [
    () => stageCommand('orbitTo', { orbit: 180 }, 1.6, easeInOut('cubic')),
    holdTail(1.6),
]);
