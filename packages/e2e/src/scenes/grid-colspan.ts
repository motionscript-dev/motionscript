import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Grid} child `colSpan`: the accent cell grows from spanning 1 column to spanning all 3. */
const wide = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { flow: 'grid', width: 700, height: 380, columns: 3, gap: 16, children: [
            el(Rect, { ref: wide, height: 'fill', colSpan: 1, fill: 'accent', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'primary', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'primary', cornerRadius: 12 }),
            el(Rect, { height: 'fill', fill: 'primary', cornerRadius: 12 }),
        ] }),
    );
}, [
    () => wide().to({ data: { colSpan: 3 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
