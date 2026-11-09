import { Rect, Fills, VideoAdjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link VideoAdjustments.echo}: a motion-trail effect compositing the current video frame with several delayed, decaying past frames, growing from a single tap to a long trail. */
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
                fill: Fills.video('video.mp4', { fit: 'fill', filters: VideoAdjustments.echo({ echoes: 1, delay: 0.05, decay: 0.5 }) }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.video('video.mp4', { fit: 'fill', filters: VideoAdjustments.echo({ echoes: 8, delay: 0.05, decay: 0.7 }) }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
