import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.bulge} with negative `strength`: a pincushion lens pinches the center inward instead of bulging outward. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                flow: 'grid',
                ref: card,
                width: 320,
                height: 320,
                cornerRadius: 20,
                fill: 'card',
                columns: 4,
                gap: 2,
                effects: Effects.bulge(0),
                children: [
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
                    el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
                    el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
                    el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
                    el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.bulge(-0.9) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
