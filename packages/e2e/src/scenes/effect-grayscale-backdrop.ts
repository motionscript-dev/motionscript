import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `Effects.grayscale({ amount, mode: 'backdrop' })`: desaturates the content beneath the node, clipped to its silhouette, while the node's own fill/stroke stays untouched. */
const lens = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            width: 'fill',
            height: 'fill',
            flow: 'horizontal',
            gap: 16,
            padding: 40,
            align: { x: 0, y: 0 },
            children: [
                el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#6990dd' }),
                el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#e8617c' }),
                el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#f2c94c' }),
            ],
        }),
    );
    stage.add(
        el(Rect, {
            ref: lens,
            width: 260,
            height: 260,
            cornerRadius: 130,
            stroke: { weight: 4, fill: '#f4f6ff' },
            effects: Effects.grayscale({ amount: 0, mode: 'backdrop' }),
        }),
    );
}, [
    () => lens().to({ data: { effects: Effects.grayscale({ amount: 1, mode: 'backdrop' }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
