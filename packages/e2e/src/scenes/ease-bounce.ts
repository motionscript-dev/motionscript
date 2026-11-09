import { Ellipse } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A ball dropping with an easeOut('bounce') landing — the classic bounce curve. */
const ball = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(el(Ellipse, { ref: ball, width: 110, height: 110, fill: 'accent', x: 0, y: -200 }));
}, [
    () => ball().to({ data: { y: 180 }, duration: 1.5, easing: easeOut('bounce') }),
    holdTail(1.5),
]);
