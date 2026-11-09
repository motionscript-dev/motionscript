import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Uniform scale animation on a centered square. */
const box = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: box, width: 180, height: 180, cornerRadius: 18, fill: 'primary', scale: 0.4 }),
        ] }),
    );
}, [
    () => box().to({ data: { scale: 1.4 }, duration: 1.3, easing: easeInOut('cubic') }),
    holdTail(1.3),
]);
