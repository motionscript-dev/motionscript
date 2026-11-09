import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { Latex } from '@motionscript/math';
import { holdTail } from './_lib';

/** Latex `stroke`: an outlined-only formula (transparent fill) thickening its stroke weight. */
const formula = createRef<Latex>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Latex, {
                ref: formula,
                latex: '\\Sigma',
                fontSize: 160,
                fill: 'transparent',
                stroke: { weight: 1, fill: 'accent' },
            }),
        ] }),
    );
}, [
    () => formula().strokeTo({ data: { weight: 5, fill: 'accent' }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
