import { FunctionPlot, NumberPlane, VectorArrow } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's linear-transformation scenes and the end of OpeningManim: a plane
 * with its two basis arrows and a circle, sheared by a matrix over its own
 * ghost, then straightened and bent by a function of its points.
 */
const plane = createRef<NumberPlane>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(NumberPlane, {
            ref: plane,
            width: 860,
            height: 480,
            xRange: [-6, 6],
            labels: false,
            ticks: false,
            children: [
                el(FunctionPlot, {
                    expression: 'x^2 + y^2 = 4',
                    stroke: { weight: 3, fill: '#facc15', align: 'center', join: 'round' },
                }),
                el(VectorArrow, {
                    head: { x: 1, y: 0 },
                    stroke: { weight: 5, fill: '#4ade80', align: 'center', endCap: 'triangle' },
                }),
                el(VectorArrow, {
                    head: { x: 0, y: 1 },
                    stroke: { weight: 5, fill: '#f87171', align: 'center', endCap: 'triangle' },
                }),
            ],
        }),
    );
}, [
    () => plane().transformTo({ data: { matrix: [[1, 1], [0, 1]] }, duration: 1.0, easing: easeInOut('quad') }),
    () => plane().transformTo({ data: { matrix: [[1, 0], [0, 1]] }, duration: 0.6, easing: easeInOut('quad') }),
    () => plane().warpTo({ data: { warp: '(x + sin(y), y + sin(x))' }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(0.4),
]);
