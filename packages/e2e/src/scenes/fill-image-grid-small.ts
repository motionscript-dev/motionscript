import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Many small image fills: each thumbnail is decoded at the level its own draw
 * needs, not at the source's size. A regression shows as soft or misplaced
 * crops at a size where the old whole-source decode happened to look right.
 */
const grid = createRef<Rect>();
const PHOTOS = ['cat.jpg', 'kingfisher.jpg'];
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: grid, flow: 'grid', width: 720, height: 400, columns: 6, gap: 12, scale: 0.85, children: [
            Array.from({ length: 24 }, (_, i) => el(Rect, {
                height: 'fill',
                cornerRadius: 8,
                fill: Fills.image(PHOTOS[i % 2], { fit: 'fill', zoom: 1 + (i % 4) * 0.25 }),
            })),
        ] }),
    );
}, [
    () => grid().to({ data: { scale: 1 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
