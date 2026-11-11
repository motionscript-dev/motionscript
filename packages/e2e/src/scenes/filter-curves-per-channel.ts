import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Adjustments.curves} stacked per-channel: separate R, G, and B tone curves layered on one image fill, each animating independently to push a teal-and-orange grade. */
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
                fill: Fills.image('kingfisher.jpg', {
                    fit: 'fill',
                    preset: { adjustments: Adjustments.curves({ points: [[0, 0], [1, 1]], channel: 'r' })
                        .curves({ points: [[0, 0], [1, 1]], channel: 'g' })
                        .curves({ points: [[0, 0], [1, 1]], channel: 'b' }) } }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: {
            fill: Fills.image('kingfisher.jpg', {
                fit: 'fill',
                preset: { adjustments: Adjustments.curves({ points: [[0, 0.15], [1, 1]], channel: 'r' })
                    .curves({ points: [[0, 0], [1, 1]], channel: 'g' })
                    .curves({ points: [[0, 0], [1, 0.7]], channel: 'b' }) } }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
