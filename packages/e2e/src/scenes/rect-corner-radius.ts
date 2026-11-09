import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Rect animating a uniform corner radius from sharp to fully rounded. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: rect, width: 260, height: 260, fill: 'primary', cornerRadius: 0 }),
        ] }),
    );
}, [
    () => rect().to({ data: { cornerRadius: 130 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
