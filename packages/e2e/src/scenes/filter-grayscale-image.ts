import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Adjustments.grayscale}: an image fill's own pixel filter desaturating the image as `amount` ramps from 0 to 1. */
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
                fill: Fills.image('kingfisher.jpg', { fit: 'fill', preset: { adjustments: Adjustments.grayscale(0) } }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.image('kingfisher.jpg', { fit: 'fill', preset: { adjustments: Adjustments.grayscale(1) } }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
