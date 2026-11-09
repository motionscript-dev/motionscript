import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A Gaussian blur effect ramping up on a labelled card. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: 'primary',
                flow: 'freeform',
                align: { x: 0, y: 0 },
                effects: Effects.blur(0),
                children: [
                    el(Text, { text: 'BLUR', fontFamily: 'Inter', fontSize: 64, fill: '#0d0f15' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.blur(18) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
