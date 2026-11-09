import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { Latex } from '@motionscript/math';
import { holdTail } from './_lib';

/** Latex `fill` as a linear gradient, sweeping its angle across the formula. */
const formula = createRef<Latex>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Latex, {
                ref: formula,
                latex: 'a^2 + b^2 = c^2',
                fontSize: 96,
                fill: Fills.linearGradient(['#6990dd', '#e8617c']),
                rotation: 0,
            }),
        ] }),
    );
}, [
    () => formula().to({ data: { rotation: 360 }, duration: 1.6, easing: easeInOut('quad') }),
    holdTail(1.6),
]);
