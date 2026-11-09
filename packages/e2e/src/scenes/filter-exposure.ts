import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Adjustments.exposure}: an image fill brightens, sweeping from a dim underexposed look to a blown-out highlight. */
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
                fill: Fills.image('kingfisher.jpg', { fit: 'fill', filters: Adjustments.exposure(0.3) }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.image('kingfisher.jpg', { fit: 'fill', filters: Adjustments.exposure(2.5) }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
