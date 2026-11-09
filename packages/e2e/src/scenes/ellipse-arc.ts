import { Ellipse } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Ellipse arc stroke: `sweep` animating from a quarter-turn to a near-full circle. */
const arc = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Ellipse, {
            ref: arc,
            width: 300,
            height: 300,
            startAngle: -90,
            sweep: 90,
            ratio: 1,
            fill: 'transparent',
            stroke: { weight: 16, fill: 'primary', cap: 'round' },
        }),
    );
}, [
    () => arc().to({ data: { sweep: 300 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
