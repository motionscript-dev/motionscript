import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.radialBlur} in zoom style: the smear grows with distance while the centre stays sharp. */
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
                effects: Effects.radialBlur({ amount: 0, samples: 24 }),
                children: [
                    el(Text, { text: 'ZOOM', fontFamily: 'Inter', fontWeight: 800, fontSize: 72, fill: '#f4f6ff' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.radialBlur({ amount: 0.5, samples: 24 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
