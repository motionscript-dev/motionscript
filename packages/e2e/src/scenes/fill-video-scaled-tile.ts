import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Four fills of one clip at four sizes, one of them tiled. A clip has one
 * decode level at a time, so every tile must be served the frame at the level
 * the largest draw needs, placed in the clip's own display pixels.
 */
const big = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'horizontal', gap: 24, align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 80, height: 45, fill: Fills.video('video.mp4', { fit: 'fill' }) }),
            el(Rect, { width: 160, height: 90, fill: Fills.video('video.mp4', { fit: 'tile', zoom: 0.1 }) }),
            el(Rect, { width: 240, height: 135, cornerRadius: 12, fill: Fills.video('video.mp4', { fit: 'fit' }) }),
            el(Rect, {
                ref: big,
                width: 320,
                height: 180,
                scale: 0.5,
                fill: Fills.video('video.mp4', { fit: 'fill' }),
            }),
        ] }),
    );
}, [
    () => big().to({ data: { scale: 1 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
