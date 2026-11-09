import { Rect } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect} `flow: 'freeform'`: three children centered and overlapping, popping in from largest to smallest. */
const back = createRef<Rect>();
const mid = createRef<Rect>();
const front = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: back, width: 360, height: 360, fill: 'primary', cornerRadius: 20, scale: 0 }),
            el(Rect, { ref: mid, width: 240, height: 240, fill: 'card', cornerRadius: 20, scale: 0 }),
            el(Rect, { ref: front, width: 120, height: 120, fill: 'accent', cornerRadius: 20, scale: 0 }),
        ] }),
    );
}, [
    () => back().to({ data: { scale: 1 }, duration: 0.5, easing: easeOut('back') }),
    () => mid().to({ data: { scale: 1 }, duration: 0.5, easing: easeOut('back') }),
    () => front().to({ data: { scale: 1 }, duration: 0.5, easing: easeOut('back') }),
    holdTail(1.5),
]);
