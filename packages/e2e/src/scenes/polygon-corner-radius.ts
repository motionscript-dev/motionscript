import { Polygon } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Polygon.cornerRadius}: a sharp-cornered pentagon rounding its vertices into smooth arcs. */
const pentagon = createRef<Polygon>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygon, {
            ref: pentagon,
            width: 280,
            height: 280,
            sides: 5,
            cornerRadius: 0,
            fill: 'accent',
        }),
    );
}, [
    () => pentagon().to({ data: { cornerRadius: 50 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
