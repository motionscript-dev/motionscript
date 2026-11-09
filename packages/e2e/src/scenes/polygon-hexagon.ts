import { Polygon } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A regular hexagon (`sides: 6`) spinning into view. */
const hexagon = createRef<Polygon>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygon, {
            ref: hexagon,
            width: 300,
            height: 300,
            sides: 6,
            fill: 'primary',
            rotation: -90,
            scale: 0.6,
        }),
    );
}, [
    () => hexagon().to({ data: { rotation: 0, scale: 1 }, duration: 1.3, easing: easeInOut('back') }),
    holdTail(1.3),
]);
