import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect.overlay}: a playing video washes over an entire subtree of child rects, sitting above them but under the stroke. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 400,
                height: 260,
                cornerRadius: 20,
                fill: 'card',
                stroke: { weight: 4, fill: 'primary' },
                overlay: Fills.video('video.mp4', { fit: 'fill', opacity: 0 }),
                flow: 'horizontal',
                gap: 16,
                padding: 20,
                align: { x: 0, y: 0 },
                children: [
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#e8617c' }),
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#f2c94c' }),
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#6990dd' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().overlayTo({ data: Fills.video('video.mp4', { fit: 'fill', opacity: 0.7 }), duration: 1, easing: easeInOut('quad') }),
    holdTail(1),
]);
