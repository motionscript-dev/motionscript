import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect.padding} (uniform): a card's inner content box shrinking inward as padding grows on every side. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: card, width: 500, height: 360, fill: 'card', cornerRadius: 16, padding: 0, children: [
            el(Rect, { width: 'fill', height: 'fill', fill: 'primary', cornerRadius: 8 }),
        ] }),
    );
}, [
    () => card().to({ data: { padding: 70 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
