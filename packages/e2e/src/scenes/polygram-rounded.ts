import { Polygram } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Polygram.cornerRadius}: a sharp 5-point star rounding both its inner and outer vertices. */
const star = createRef<Polygram>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygram, {
            ref: star,
            width: 300,
            height: 300,
            sides: 5,
            cornerRadius: 0,
            fill: 'accent',
        }),
    );
}, [
    () => star().to({ data: { cornerRadius: 24 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
