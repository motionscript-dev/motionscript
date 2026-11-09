import { NetworkGraph } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's Graph and change_layout: a small graph drawn in a circle, rearranged
 * as a tree and then by springs, with a path through it coloured in.
 */
const graph = createRef<NetworkGraph>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(NetworkGraph, {
            ref: graph,
            width: 760,
            height: 460,
            fontFamily: 'Inter',
            vertices: ['1', '2', '3', '4', '5', '6', '7'],
            edges: [
                { from: '1', to: '2' }, { from: '1', to: '3' }, { from: '2', to: '4' }, { from: '2', to: '5' },
                { from: '3', to: '6' }, { from: '3', to: '7' }, { from: '4', to: '5' }, { from: '6', to: '7' },
            ],
        }),
    );
}, [
    () => graph().arrangeTo({ data: { arrangement: 'tree' }, duration: 1.0, easing: easeInOut('quad') }),
    () => graph().partFillTo({ data: { part: '1-3', fill: '#f59e0b' }, duration: 0.4 }),
    () => graph().partFillTo({ data: { part: '7', fill: '#f59e0b' }, duration: 0.4 }),
    () => graph().arrangeTo({ data: { arrangement: 'spring' }, duration: 1.0, easing: easeInOut('quad') }),
    holdTail(0.3),
]);
