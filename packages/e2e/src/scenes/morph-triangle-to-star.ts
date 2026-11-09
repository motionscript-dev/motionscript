import { Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

const TRIANGLE = 'M 0 -110 L 95 70 L -95 70 Z';
const STAR =
    'M 0 -110 L 26 -35 L 105 -35 L 42 13 L 65 88 L 0 42 L -65 88 L -42 13 L -105 -35 L -26 -35 Z';

/** {@link Path}'s `data` prop morphing from a 3-point triangle into a 10-point star — different point counts and winding, reconciled automatically by the morph plan's subdivision + ring alignment. */
const shape = createRef<Path>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Path, { ref: shape, data: TRIANGLE, fill: 'accent' }),
    );
}, [
    () => shape().to({ data: { data: STAR }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
