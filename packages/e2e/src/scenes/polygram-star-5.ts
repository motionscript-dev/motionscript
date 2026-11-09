import { Polygram } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A 5-point star (polygram, default ratio) spinning into view. */
const star = createRef<Polygram>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Polygram, {
            ref: star,
            width: 300,
            height: 300,
            sides: 5,
            fill: 'primary',
            rotation: -90,
            scale: 0.6,
        }),
    );
}, [
    () => star().to({ data: { rotation: 0, scale: 1 }, duration: 1.3, easing: easeInOut('back') }),
    holdTail(1.3),
]);
