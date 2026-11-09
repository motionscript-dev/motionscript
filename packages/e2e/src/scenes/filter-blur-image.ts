import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Adjustments.blur}: an image fill's own pixel filter, blurring the image itself (not the node) from sharp to soft. */
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
                fill: Fills.image('kingfisher.jpg', { fit: 'fill', filters: Adjustments.blur(0) }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.image('kingfisher.jpg', { fit: 'fill', filters: Adjustments.blur(16) }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
