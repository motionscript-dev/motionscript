import { Ellipse } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Ellipse with equal width and height (a circle), popping in with a scale. */
const circle = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Ellipse, {
            ref: circle,
            width: 280,
            height: 280,
            fill: 'accent',
            scale: 0,
        }),
    );
}, [
    () => circle().to({ data: { scale: 1 }, duration: 0.9, easing: easeOut('back') }),
    holdTail(0.9),
]);
