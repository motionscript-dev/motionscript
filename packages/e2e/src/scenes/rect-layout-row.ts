import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect} `flow: 'horizontal'`: three children laid left-to-right, with the gap animating wider. */
const row = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: row, width: 700, height: 220, flow: 'horizontal', gap: 8, children: [
            el(Rect, { width: 140, height: 'fill', fill: 'primary', cornerRadius: 12 }),
            el(Rect, { width: 140, height: 'fill', fill: 'accent', cornerRadius: 12 }),
            el(Rect, { width: 140, height: 'fill', fill: 'primary', cornerRadius: 12 }),
        ] }),
    );
}, [
    () => row().to({ data: { gap: 48 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
