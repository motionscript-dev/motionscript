import { Rect, Fills, VideoAdjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link VideoAdjustments.grayscale}: a playing video desaturates as `amount` ramps from 0 to 1. */
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
                fill: Fills.video('video.mp4', { fit: 'fill', filters: VideoAdjustments.grayscale(0) }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.video('video.mp4', { fit: 'fill', filters: VideoAdjustments.grayscale(1) }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
