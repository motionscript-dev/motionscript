import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.scatter} with `axis: 'both'`: pixels jitter randomly on both axes as `strength` ramps up. */
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
                fill: 'card',
                flow: 'freeform',
                align: { x: 0, y: 0 },
                effects: Effects.scatter(0),
                children: [
                    el(Text, { text: 'NOISE', fontFamily: 'Inter', fontWeight: 800, fontSize: 56, fill: 'primary' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.scatter(24) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
