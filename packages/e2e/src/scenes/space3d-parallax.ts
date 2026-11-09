import { Ellipse, Rect } from '@motionscript/sdk';
import { easeInOut, easeOut, el, scene, stageCommand } from '../doc';
import { holdTail } from './_lib';

/**
 * The stage as a 2.5D space: layers at depths, one camera panning and pushing
 * in. Panning alone gives parallax — the far layers slide less — and the dolly
 * grows the near card faster than the ridge behind it.
 *
 * Authored near-first on purpose: in a space siblings paint far to near, so the
 * order of the rows is not the order of the picture.
 */
export default scene((stage) => {
    stage.set({ fill: '#0b0d12', space3D: true, perspective: 1000 });
    stage.add([
        el(Rect, { width: 300, height: 180, cornerRadius: 20, fill: '#e0533d', depth: 150 }),
        el(Rect, { width: 1600, height: 300, y: -330, cornerRadius: 150, fill: '#34425f', depth: -250 }),
        el(Rect, { width: 2200, height: 420, y: -300, cornerRadius: 210, fill: '#232d45', depth: -700 }),
        el(Ellipse, { width: 360, height: 360, x: -700, y: 380, fill: '#f2c14e', depth: -1600 }),
        el(Rect, { width: 4000, height: 2200, fill: '#141a2b', depth: -2000 }),
    ]);
}, [
    [
        () => stageCommand('panTo', { lookAt: { x: 100, y: 30 } }, 1.6, easeInOut('cubic')),
        () => stageCommand('dollyTo', { dolly: 250 }, 1.6, easeOut('quad')),
    ],
    holdTail(1.6),
]);
