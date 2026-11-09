import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Adjustments.curves}: a linear (no-op) RGB tone curve bends into a high-contrast S-curve, deepening shadows and lifting highlights. */
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
                fill: Fills.image('kingfisher.jpg', { fit: 'fill', filters: Adjustments.curves({ points: [[0, 0], [0.5, 0.5], [1, 1]] }) }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.image('kingfisher.jpg', { fit: 'fill', filters: Adjustments.curves({ points: [[0, 0], [0.25, 0.1], [0.75, 0.9], [1, 1]] }) }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
