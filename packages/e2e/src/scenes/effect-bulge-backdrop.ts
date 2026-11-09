import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `Effects.bulge({ strength, mode: 'backdrop' })`: a dome lens over the content beneath the node, clipped to its silhouette, while the node's own edges stay sharp. */
const lens = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { flow: 'grid', width: 'fill', height: 'fill', columns: 4, gap: 2, padding: 40, children: [
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
        ] }),
    );
    stage.add(
        el(Rect, {
            ref: lens,
            width: 260,
            height: 260,
            cornerRadius: 130,
            stroke: { weight: 4, fill: '#f4f6ff' },
            effects: Effects.bulge({ strength: 0, mode: 'backdrop' }),
        }),
    );
}, [
    () => lens().to({ data: { effects: Effects.bulge({ strength: 0.9, mode: 'backdrop' }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
