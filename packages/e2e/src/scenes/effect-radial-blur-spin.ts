import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.radialBlur} in spin style: the same taps swept tangentially, reading as rotation. */
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
                flow: 'horizontal',
                gap: 16,
                padding: 20,
                effects: Effects.radialBlur({ amount: 0, style: 'spin', samples: 24 }),
                children: [
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#6990dd' }),
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#e8617c' }),
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#f2c94c' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.radialBlur({ amount: 0.5, style: 'spin', samples: 24 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
