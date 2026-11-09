import { Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `cap: 'round'`: an open stroke's ends extend into a semicircle past the path's terminal points, growing more visible as the weight thickens. */
const line = createRef<Path>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Path, {
            ref: line,
            data: 'M -260 0 L 260 0',
            stroke: { weight: 8, fill: 'primary', cap: 'round' },
        }),
    );
}, [
    () => line().strokeTo({ data: { weight: 60, fill: 'primary', cap: 'round' }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
