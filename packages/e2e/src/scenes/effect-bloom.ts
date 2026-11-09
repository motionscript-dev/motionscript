import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.bloom}: bright areas bleed soft light outward as `intensity` ramps up. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: '#0d0f15' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: '#0d0f15',
                flow: 'freeform',
                align: { x: 0, y: 0 },
                effects: Effects.bloom({ threshold: 0.4, radius: 20, intensity: 0 }),
                children: [
                    el(Text, { text: 'BLOOM', fontFamily: 'Inter', fontWeight: 800, fontSize: 56, fill: '#f4f6ff' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.bloom({ threshold: 0.4, radius: 20, intensity: 2.5 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
