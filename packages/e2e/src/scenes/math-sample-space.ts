import { SampleSpace } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's SampleSpace: a whole split into A and not A, each split again by B,
 * every part's area its probability; the cuts then move to new odds.
 */
const space = createRef<SampleSpace>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(SampleSpace, {
            ref: space,
            width: 560,
            height: 440,
            fontFamily: 'Inter',
            columnShares: [0.3, 0.7],
            rowShares: [0.8, 0.2],
            columnLabels: ['A', 'not A'],
            rowLabels: ['B', 'not B'],
            values: true,
        }),
    );
}, [
    () => space().divideTo({ data: { columnShares: [0.6, 0.4], rowShares: [0.5, 0.35] }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(0.4),
]);
