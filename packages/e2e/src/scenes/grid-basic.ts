import { Rect } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Basic {@link Grid}: six cells auto-placed into 3 equal-width columns, popping in together. */
const grid = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { flow: 'grid', ref: grid, width: 700, height: 380, columns: 3, gap: 16, scale: 0, children: [
            el(Rect, { height: 'fill', fill: 'primary', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'accent', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'primary', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'accent', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'primary', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'accent', cornerRadius: 12 }),
        ] }),
    );
}, [
    () => grid().to({ data: { scale: 1 }, duration: 1.1, easing: easeOut('back') }),
    holdTail(1.1),
]);
