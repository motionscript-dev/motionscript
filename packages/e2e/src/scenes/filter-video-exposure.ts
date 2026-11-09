import { Rect, Fills, VideoAdjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link VideoAdjustments.exposure}: a playing video brightens, sweeping from dim to blown-out. */
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
                fill: Fills.video('video.mp4', { fit: 'fill', filters: VideoAdjustments.exposure(0.3) }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.video('video.mp4', { fit: 'fill', filters: VideoAdjustments.exposure(2.5) }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
