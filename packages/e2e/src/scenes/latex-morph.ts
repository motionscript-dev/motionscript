import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { Latex } from '@motionscript/math';
import { holdTail } from './_lib';

/** Latex `to({ latex })`: one formula morphs smoothly, token by token, into another. */
const formula = createRef<Latex>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Latex, { ref: formula, latex: 'x^2 + y^2 = r^2', fontSize: 80, fill: '#f4f6ff' }),
        ] }),
    );
}, [
    () => formula().to({ data: { latex: 'e^{i\\pi} + 1 = 0' }, duration: 1.5, easing: easeInOut('quad') }),
    holdTail(1.5),
]);
