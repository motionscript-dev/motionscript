import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Fills.video}: a playing video clip used as a shape's fill, growing into frame. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 280,
                height: 280,
                cornerRadius: 24,
                scale: 0.6,
                fill: Fills.video('video.mp4', { fit: 'fill' }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { scale: 1 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
