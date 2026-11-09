import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.streak}: a bright pass smeared along one axis, unlike bloom's even halo. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 520,
                height: 300,
                cornerRadius: 20,
                fill: '#05070d',
                clip: true,
                flow: 'freeform',
                align: { x: 0, y: 0 },
                effects: Effects.streak({ intensity: 0, threshold: 0.4, length: 220 }),
                children: [
                    el(Text, { text: 'GLARE', fontFamily: 'Inter', fontWeight: 800, fontSize: 64, fill: '#fff3d0' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.streak({ intensity: 2.4, threshold: 0.4, length: 220 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
