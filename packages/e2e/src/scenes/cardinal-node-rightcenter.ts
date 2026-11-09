import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { PinnedRect } from '@/components/pinned';
import { holdTail } from './_lib';

/** A satellite node's `center` pinned to the card's `centerRight` anchor, following it as the card grows. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: card, width: 220, height: 140, cornerRadius: 16, fill: 'card' }),
            el(PinnedRect, {
                width: 20,
                height: 20,
                cornerRadius: 10,
                fill: 'primary',
                pin: 'centerRight',
                on: 'rect1',
            }),
        ] }),
    );
}, [
    () => card().to({ data: { width: 360, height: 240 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
