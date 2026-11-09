import { Rect, Fills, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.curves}: a lifted-shadow tone curve fades the blacks of a gradient card. */
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
                fill: Fills.linearGradient(['#0d0f15', '#f4f6ff']),
                effects: Effects.curves({ points: [[0, 0], [0.5, 0.5], [1, 1]] }),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.curves({ points: [[0, 0.3], [0.5, 0.6], [1, 0.85]] }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
