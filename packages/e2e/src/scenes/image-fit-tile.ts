import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `fit: 'tile'` — the image repeats at a fixed size (here scaled down via
 * `zoom`) to pave the box. We grow the box from small to large so more and
 * more tiles march into view — the box revealing additional repeats is the
 * tiling behaviour made visible.
 */
const box = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });

    stage.add(
        el(Rect, {
            ref: box,
            width: 200,
            height: 200,
            cornerRadius: 20,
            fill: Fills.image('kingfisher.jpg', { fit: 'tile', zoom: 0.16 }),
            stroke: { weight: 3, fill: 'primary' },
        }),
    );
}, [
    () => box().to({ data: { width: 720, height: 440 }, duration: 1.4, easing: easeInOut('cubic') }),
    holdTail(1.4),
]);
