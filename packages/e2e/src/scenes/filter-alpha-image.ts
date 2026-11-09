import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Adjustments.alpha}: an image fill's opacity filter fading the image out from fully opaque to nearly transparent. */
const image = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    const card = createRef<Rect>();
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 280,
                height: 280,
                cornerRadius: 24,
                fill: 'card',
                children: [
                    el(Rect, {
                        ref: image,
                        width: 'fill',
                        height: 'fill',
                        cornerRadius: 24,
                        fill: Fills.image('cat.jpg', { fit: 'fill', filters: Adjustments.alpha(1) }),
                    }),
                ],
            }),
        ] }),
    );
}, [
    () => image().to({ data: { fill: Fills.image('cat.jpg', { fit: 'fill', filters: Adjustments.alpha(0.1) }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
