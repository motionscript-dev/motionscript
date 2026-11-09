import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect} `flow: 'vertical'`: three children laid top-to-bottom, with the gap animating wider. */
const column = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: column, width: 220, height: 420, flow: 'vertical', gap: 8, children: [
            el(Rect, { width: 'fill', height: 100, fill: 'primary', cornerRadius: 12 }),
            el(Rect, { width: 'fill', height: 100, fill: 'accent', cornerRadius: 12 }),
            el(Rect, { width: 'fill', height: 100, fill: 'primary', cornerRadius: 12 }),
        ] }),
    );
}, [
    () => column().to({ data: { gap: 32 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
