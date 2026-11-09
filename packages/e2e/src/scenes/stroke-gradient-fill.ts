import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A stroke's `fill` is the same loose {@link Fill} type as a node's `fill` — here a linear gradient sweeps its angle instead of a flat color. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 300,
                height: 300,
                cornerRadius: 24,
                fill: 'card',
                stroke: { weight: 16, fill: Fills.linearGradient(['#6990dd', '#e8617c']) },
            }),
        ] }),
    );
}, [
    () => rect().strokeTo({ data: { weight: 16, fill: Fills.linearGradient(['#f2c94c', '#e8617c']) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
