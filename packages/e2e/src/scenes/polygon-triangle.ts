import { Polygon } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** An equilateral triangle (`sides: 3`) spinning into view. */
const triangle = createRef<Polygon>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygon, {
            ref: triangle,
            width: 300,
            height: 300,
            sides: 3,
            fill: 'primary',
            rotation: -90,
            scale: 0.6,
        }),
    );
}, [
    () => triangle().to({ data: { rotation: 0, scale: 1 }, duration: 1.3, easing: easeInOut('back') }),
    holdTail(1.3),
]);
