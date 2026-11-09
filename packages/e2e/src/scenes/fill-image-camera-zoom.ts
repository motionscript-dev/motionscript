import { Camera, Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A camera zooming far into a small image fill. The node's box never changes,
 * so only the canvas matrix says the draw now needs more pixels — the frame at
 * full zoom must show the photo's own detail, not a magnified thumbnail.
 */
const camera = createRef<Camera>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Camera, { ref: camera, width: 'fill', height: 'fill', zoom: 1, children: [
            el(Rect, {
                width: 160,
                height: 110,
                cornerRadius: 6,
                fill: Fills.image('kingfisher.jpg', { fit: 'fill' }),
            }),
        ] }),
    );
}, [
    () => camera().to({ data: { zoom: 7 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
