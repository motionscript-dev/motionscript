import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Effects.blockDisplace}: horizontal bands tear sideways as `amount` ramps up.
 *
 * `seed` is held fixed so the displacement is a pure function of the band index —
 * the frame renders identically every time.
 */
const card = createRef<Rect>();
const shape = { size: 24, density: 0.6, seed: 3 };
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 420,
                height: 280,
                cornerRadius: 20,
                fill: 'card',
                flow: 'horizontal',
                gap: 16,
                padding: 20,
                effects: Effects.blockDisplace({ amount: 0, ...shape }),
                children: [
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#6990dd' }),
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#e8617c' }),
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#f2c94c' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.blockDisplace({ amount: 70, ...shape }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
