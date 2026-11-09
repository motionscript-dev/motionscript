import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Rect with fixed width/height and a solid fill, gently scaling in. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: rect, width: 320, height: 200, fill: 'primary', scale: 0.6 }),
        ] }),
    );
}, [
    () => rect().to({ data: { scale: 1 }, duration: 1, easing: easeInOut('quad') }),
    holdTail(1),
]);
