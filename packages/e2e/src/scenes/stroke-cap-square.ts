import { Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `cap: 'square'`: an open stroke's ends extend by half the weight past the path's terminal points, like `'butt'` but squared off further out. */
const line = createRef<Path>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Path, {
            ref: line,
            data: 'M -260 0 L 260 0',
            stroke: { weight: 8, fill: 'primary', cap: 'square' },
        }),
    );
}, [
    () => line().strokeTo({ data: { weight: 60, fill: 'primary', cap: 'square' }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
