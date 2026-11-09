import { Ellipse } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Ellipse `ratio` (the hole, as a fraction of the outer radius) widening a donut into a thin ring. */
const ellipse = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Ellipse, {
            ref: ellipse,
            width: 300,
            height: 300,
            ratio: 0.4,
            fill: 'primary',
        }),
    );
}, [
    () => ellipse().to({ data: { ratio: 0.85 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
