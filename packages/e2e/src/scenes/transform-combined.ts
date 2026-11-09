import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Position, rotation, and scale all animating together on one node in a single tween. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            ref: card,
            width: 160,
            height: 160,
            cornerRadius: 20,
            fill: 'primary',
            center: { x: -260, y: 100 },
            rotation: 0,
            scale: 0.6,
        }),
    );
}, [
    () => card().to({ data: { x: 260, y: -100, rotation: 270, scale: 1.4 }, duration: 1.6, easing: easeInOut('quad') }),
    holdTail(1.6),
]);
