import { Rect } from '@motionscript/sdk';
import { createRef, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/** Marching-ants: a dashed stroke with an animated dashOffset. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 360,
                height: 240,
                cornerRadius: 16,
                fill: 'card',
                stroke: { weight: 6, fill: 'primary', dash: [24, 16], dashOffset: 0 },
            }),
        ] }),
    );
}, [
    // One full dash period (24 + 16 = 40) so first and last frames line up.
    () => rect().to({ data: { stroke: { weight: 6, fill: 'primary', dash: [24, 16], dashOffset: 40 } }, duration: 1.5, easing: linear() }),
    holdTail(1.5),
]);
