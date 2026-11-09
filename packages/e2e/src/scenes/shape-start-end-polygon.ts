import { Polygon } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Polygon}'s `start`/`end` trim props (0..1) sweeping a stroked hexagon's outline from a single point into a complete loop. */
const hex = createRef<Polygon>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygon, {
            ref: hex,
            sides: 6,
            width: 280,
            height: 280,
            stroke: { weight: 14, cap: 'round', join: 'round', fill: 'primary' },
            start: 0,
            end: 0,
        }),
    );
}, [
    () => hex().to({ data: { end: 1 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
