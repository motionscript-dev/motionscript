import { Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `cap: 'butt'` (the default): an open stroke's ends are flush, with no extension past the path's terminal points. The weight thickens so the flat-cut ends read clearly. */
const line = createRef<Path>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Path, {
            ref: line,
            data: 'M -260 0 L 260 0',
            stroke: { weight: 8, fill: 'primary', cap: 'butt' },
        }),
    );
}, [
    () => line().strokeTo({ data: { weight: 60, fill: 'primary', cap: 'butt' }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
