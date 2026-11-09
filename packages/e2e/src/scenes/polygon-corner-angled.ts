import { Polygon } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Polygon.cornerStyle} `'angled'`: a rounded hexagon chamfers into flat-cut corners mid-tween. */
const hexagon = createRef<Polygon>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygon, {
            ref: hexagon,
            width: 280,
            height: 280,
            sides: 6,
            cornerRadius: 60,
            cornerStyle: 'rounded',
            fill: 'primary',
        }),
    );
}, [
    () => hexagon().to({ data: { cornerStyle: 'angled' }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
