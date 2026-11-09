import { Rect } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { Latex } from '@motionscript/math';
import { holdTail } from './_lib';

/** Latex node rendering a more complex multi-symbol formula (an integral), fading in. */
const formula = createRef<Latex>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Latex, {
                ref: formula,
                latex: '\\int_{0}^{\\infty} e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}',
                fontSize: 56,
                fill: '#f4f6ff',
                opacity: 0,
            }),
        ] }),
    );
}, [
    () => formula().to({ data: { opacity: 1 }, duration: 0.8, easing: easeOut('quad') }),
    holdTail(0.8),
]);
