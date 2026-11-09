import { Ellipse } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Ellipse pie slice: a filled wedge with `sweep` opening from a sliver to a near-full circle. */
const pie = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Ellipse, {
            ref: pie,
            width: 300,
            height: 300,
            startAngle: -90,
            sweep: 20,
            fill: 'accent',
            stroke: { weight: 3, fill: 'bg' },
        }),
    );
}, [
    () => pie().to({ data: { sweep: 320 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
