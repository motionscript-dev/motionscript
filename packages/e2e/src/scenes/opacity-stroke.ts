import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Stroke-level `opacity`: only the stroke fades, leaving the fill fully opaque throughout. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            ref: card,
            width: 300,
            height: 200,
            cornerRadius: 20,
            fill: 'card',
            stroke: { weight: 10, align: 'center', fill: Fills.color('primary', { opacity: 1 }) },
        }),
    );
}, [
    () => card().strokeTo({ data: { fill: Fills.color('primary', { opacity: 0.1 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
