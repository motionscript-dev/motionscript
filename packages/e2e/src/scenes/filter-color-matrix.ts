import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

const IDENTITY = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
];

// Swaps the red and blue channels (4x5 row-major: rows are [R,G,B,A,bias]).
const CHANNEL_SWAP = [
    0, 0, 1, 0, 0,
    0, 1, 0, 0, 0,
    1, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
];

/** {@link Adjustments.colorMatrix}: an arbitrary 4x5 color matrix morphing from identity into a red/blue channel swap. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 320,
                height: 320,
                cornerRadius: 24,
                fill: Fills.image('kingfisher.jpg', { fit: 'fill', preset: { adjustments: Adjustments.colorMatrix(IDENTITY) } }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.image('kingfisher.jpg', { fit: 'fill', preset: { adjustments: Adjustments.colorMatrix(CHANNEL_SWAP) } }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
