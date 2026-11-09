import { Path } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Path.data} as a raw SVG path string: a heart shape popping into view. */
const heart = createRef<Path>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Path, {
            ref: heart,
            data: 'M 0 60 C -120 -20 -100 -120 -20 -120 C 0 -120 0 -90 0 -90 C 0 -90 0 -120 20 -120 C 100 -120 120 -20 0 60 Z',
            fill: 'accent',
            scale: 0,
        }),
    );
}, [
    () => heart().to({ data: { scale: 1 }, duration: 1.1, easing: easeOut('back') }),
    holdTail(1.1),
]);
