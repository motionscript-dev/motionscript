import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A rect with a linear gradient fill, rotating the whole shape to sweep the gradient angle. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 360,
                height: 240,
                cornerRadius: 20,
                rotation: 0,
                fill: Fills.linearGradient(['#6990dd', '#e8617c']),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { rotation: 90 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
