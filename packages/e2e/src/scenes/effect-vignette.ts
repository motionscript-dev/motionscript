import { Rect, Fills, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.vignette}: the corners of a bright card darken as `amount` ramps from 0 to 1. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 420,
                height: 280,
                cornerRadius: 20,
                fill: Fills.linearGradient(['#f4f6ff', '#9fb4e8']),
                effects: Effects.vignette(0),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.vignette({ amount: 1, radius: 0.4, softness: 0.7 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
