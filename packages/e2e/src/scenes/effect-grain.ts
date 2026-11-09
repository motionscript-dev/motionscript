import { Rect, Fills, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Effects.grain}: film noise builds over a smooth gradient as `amount` ramps up.
 *
 * `animated` is deliberately left off — the field is then a pure function of the
 * pixel and the seed, so the frame is byte-identical on every render.
 */
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
                fill: Fills.linearGradient(['#20263a', '#dfe6ff']),
                effects: Effects.grain({ amount: 0, size: 2 }),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.grain({ amount: 0.6, size: 2 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
