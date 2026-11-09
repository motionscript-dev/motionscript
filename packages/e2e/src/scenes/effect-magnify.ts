import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.magnify}: a lens magnifies the backdrop beneath the node, scaling up from no zoom to a strong 3x. */
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
            width: 220,
            height: 220,
            cornerRadius: 110,
            stroke: { weight: 4, fill: '#f4f6ff' },
            effects: Effects.magnify(1),
        }),
    );
}, [
    () => lens().to({ data: { effects: Effects.magnify(3) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
