import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.sharpen}: edge contrast rises (and finally haloes) as `amount` ramps up. */
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
                fill: 'card',
                flow: 'freeform',
                align: { x: 0, y: 0 },
                effects: Effects.sharpen({ amount: 0, radius: 3 }),
                children: [
                    el(Text, { text: 'SHARP', fontFamily: 'Inter', fontWeight: 700, fontSize: 72, fill: 'primary' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.sharpen({ amount: 3, radius: 3 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
