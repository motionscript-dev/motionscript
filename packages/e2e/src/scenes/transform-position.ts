import { Ellipse } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A circle animating its x/y position across the viewport. */
const ball = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(el(Ellipse, { ref: ball, width: 120, height: 120, fill: 'primary', x: -300, y: -120 }));
}, [
    () => ball().to({ data: { x: 300, y: 120 }, duration: 1.4, easing: easeInOut('cubic') }),
    holdTail(1.4),
]);
