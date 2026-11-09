import { Ellipse } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Ellipse}'s `start`/`end` trim props (0..1) sweeping a stroked ring open from a single point into a full circle. */
const ring = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Ellipse, {
            ref: ring,
            width: 300,
            height: 300,
            stroke: { weight: 16, cap: 'round', fill: 'primary' },
            start: 0,
            end: 0,
        }),
    );
}, [
    () => ring().to({ data: { end: 1 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
