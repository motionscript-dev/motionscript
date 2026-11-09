import { Polygram } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Polygram.ratio}: a sharp-pointed star blunting toward a near-regular polygon as ratio approaches 1. */
const star = createRef<Polygram>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygram, {
            ref: star,
            width: 300,
            height: 300,
            sides: 5,
            ratio: 0.35,
            fill: 'accent',
        }),
    );
}, [
    () => star().to({ data: { ratio: 0.9 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
