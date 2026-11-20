import { Repeater, Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Repeater} as a radial burst: one bar above the centre, turned 30° a copy about the centre, fading from 100% to 15%; the count grows from one to twelve, the last copy fading in. */
const burst = createRef<Repeater>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Repeater, {
            ref: burst, width: 'fill', height: 'fill',
            copies: 1, stepPosition: { x: 0, y: 0 }, stepRotation: 30, startOpacity: 1, endOpacity: 0.15,
            children: [el(Rect, { y: 110, width: 18, height: 70, cornerRadius: 9, fill: '#28d6c8' })],
        }),
    );
}, [
    () => burst().to({ data: { copies: 12 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
