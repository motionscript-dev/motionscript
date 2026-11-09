import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { Latex } from '@motionscript/math';
import { holdTail } from './_lib';

/**
 * A formula written on glyph by glyph, one of its parts coloured by name, then
 * morphed into a formula that still writes that part: the colour travels with it.
 */
const formula = createRef<Latex>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Latex, {
                ref: formula,
                latex: 'a^2 + b^2 = c^2',
                fontSize: 90,
                fill: '#f4f6ff',
                written: 0,
                partFills: [{ part: 'c^2', fill: '#facc15' }],
            }),
        ] }),
    );
}, [
    () => formula().writeTo({ data: { written: 1 }, duration: 1.2, easing: easeInOut('quad') }),
    () => formula().partFillTo({ data: { part: 'a^2', fill: '#58a6ff' }, duration: 0.4 }),
    () => formula().morphTo({ data: { latex: 'c^2 - b^2 = a^2' }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(0.6),
]);
