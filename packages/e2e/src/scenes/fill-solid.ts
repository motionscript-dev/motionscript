import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A plain CSS color string as `fill` is shorthand for a solid fill; it tweens like any other color. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: rect, width: 300, height: 300, cornerRadius: 24, fill: '#6990dd' }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: '#e8617c' }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
