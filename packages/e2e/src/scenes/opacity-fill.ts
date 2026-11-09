import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Fill-level `opacity`: only the fill itself fades, leaving the stroke fully opaque throughout. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            ref: card,
            width: 300,
            height: 200,
            cornerRadius: 20,
            fill: Fills.color('primary', { opacity: 1 }),
            stroke: { weight: 6, fill: '#f4f6ff' },
        }),
    );
}, [
    () => card().to({ data: { fill: Fills.color('primary', { opacity: 0.1 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
