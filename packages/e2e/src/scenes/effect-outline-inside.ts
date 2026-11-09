import { Ellipse, Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.outline} with `position: 'inside'`: the band eats inward, leaving the footprint unchanged. */
const disc = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Ellipse, {
                ref: disc,
                width: 280,
                height: 280,
                fill: 'primary',
                effects: Effects.outline({ width: 0, color: '#f4f6ff', position: 'inside' }),
            }),
        ] }),
    );
}, [
    () => disc().to({ data: { effects: Effects.outline({ width: 26, color: '#f4f6ff', position: 'inside' }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
