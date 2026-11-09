import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Node2D-level `opacity`: the whole node — fill, stroke, and children together — fades as one unit. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            ref: card,
            width: 300,
            height: 200,
            cornerRadius: 20,
            fill: 'primary',
            stroke: { weight: 6, fill: '#f4f6ff' },
            opacity: 1,
        }),
    );
}, [
    () => card().to({ data: { opacity: 0.1 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
