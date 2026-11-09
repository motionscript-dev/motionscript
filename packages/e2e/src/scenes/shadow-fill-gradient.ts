import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A shadow's `fill` is the same loose {@link Fill} type as a node's `fill` — here a colored gradient instead of a flat black. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 300,
                height: 200,
                cornerRadius: 20,
                fill: '#f4f6ff',
                shadow: { blur: 30, offset: { x: 0, y: 20 }, fill: Fills.linearGradient(['#6990dd', '#e8617c']) },
            }),
        ] }),
    );
}, [
    () => card().to({ data: { shadow: { blur: 30, offset: { x: 0, y: 20 }, fill: Fills.linearGradient(['#f2c94c', '#e8617c']) } }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
