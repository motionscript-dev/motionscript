import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `width: 'hug', height: 'hug'` (the default for a `flow: 'vertical'` Rect):
 * the card's own size tracks its content, so growing the inner child also
 * grows the surrounding card with no explicit size set on the card itself.
 */
const content = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { flow: 'vertical', fill: 'card', cornerRadius: 16, padding: 24, children: [
                el(Rect, { ref: content, width: 120, height: 120, fill: 'accent', cornerRadius: 8 }),
            ] }),
        ] }),
    );
}, [
    () => content().to({ data: { width: 360, height: 280 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
