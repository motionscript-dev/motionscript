import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { PinnedRect } from '@/components/pinned';
import { holdTail } from './_lib';

/** A card's resolved cardinal points (`topLeft`, `topCenter`, ..., `bottomRight`) tracked live by a marker that hops between them as the card rotates and scales. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    const marker = createRef<Rect>();
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: card, width: 300, height: 180, cornerRadius: 16, fill: 'card', rotation: 0 }),
            el(PinnedRect, {
                ref: marker,
                width: 16,
                height: 16,
                cornerRadius: 8,
                fill: 'primary',
                pin: 'topRight',
                on: 'rect1',
            }),
        ] }),
    );
}, [
    () => card().to({ data: { rotation: 35, scale: 1.2 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
