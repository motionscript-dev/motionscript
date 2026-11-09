import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `fit: 'fill'` — the image scales uniformly to *cover* the box, cropping the
 * overflow and staying centered (no distortion, no letterboxing). We animate the
 * box from a tall portrait to a wide landscape so the crop visibly slides from
 * showing the bird's full height to cropping top/bottom — the cover behaviour.
 */
const box = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });

    stage.add(
        el(Rect, {
            ref: box,
            width: 260,
            height: 440,
            cornerRadius: 20,
            fill: Fills.image('kingfisher.jpg', { fit: 'fill' }),
            stroke: { weight: 3, fill: 'primary' },
        }),
    );
}, [
    () => box().to({ data: { width: 620, height: 320 }, duration: 1.4, easing: easeInOut('cubic') }),
    holdTail(1.4),
]);
