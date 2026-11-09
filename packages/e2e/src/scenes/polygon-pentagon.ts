import { Polygon } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A regular pentagon (`sides: 5`, the default) spinning into view. */
const pentagon = createRef<Polygon>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygon, {
            ref: pentagon,
            width: 300,
            height: 300,
            sides: 5,
            fill: 'accent',
            rotation: -90,
            scale: 0.6,
        }),
    );
}, [
    () => pentagon().to({ data: { rotation: 0, scale: 1 }, duration: 1.3, easing: easeInOut('back') }),
    holdTail(1.3),
]);
