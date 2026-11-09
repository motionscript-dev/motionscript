import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { LutRect } from '@/components/lut-rect';
import { holdTail } from './_lib';

/**
 * {@link Adjustments.lut}: a measured colour cube dialled in from 0 to full.
 *
 * The cube is a Float32Array, which no document can carry, so it lives in a node
 * type of its own (`LutRect`) and the document names only how much of it to apply.
 */
const rect = createRef<LutRect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });

    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(LutRect, { ref: rect, width: 320, height: 320, cornerRadius: 24 }),
        ] }),
    );
}, [
    () => rect().to({ data: { amount: 1 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
