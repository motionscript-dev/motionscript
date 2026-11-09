import { NumberPlane, PlotPoint, VectorArrow } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's VectorArrow: a number plane, a dot at the origin and an arrow to
 * (2, 2), each labelled. The arrow grows from its tail and then swings to (3, -1).
 */
const arrow = createRef<VectorArrow>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(NumberPlane, {
            width: 900,
            height: 500,
            fontFamily: 'Inter',
            xRange: [-7, 7],
            yRange: [-1, 1],
            labels: false,
            children: [
                el(VectorArrow, {
                    ref: arrow,
                    tail: { x: 0, y: 0 },
                    head: { x: 2, y: 2 },
                    end: 0,
                    stroke: { weight: 5, fill: 'white', align: 'center', endCap: 'triangle' },
                }),
                el(PlotPoint, {
                    x: 0,
                    y: 0,
                    radius: 7,
                    fill: 'white',
                    label: '(0, 0)',
                    labelSide: 'below',
                    labelSize: 22,
                    fontFamily: 'Inter',
                }),
                el(PlotPoint, {
                    x: 2,
                    y: 2,
                    radius: 0,
                    label: '(2, 2)',
                    labelSide: 'right',
                    labelSize: 22,
                    fontFamily: 'Inter',
                }),
            ],
        }),
    );
}, [
    () => arrow().progressTo({ data: { end: 1 }, duration: 0.7, easing: easeInOut('quad') }),
    () => arrow().endpointsTo({ data: { head: { x: 3, y: -1 } }, duration: 0.9, easing: easeInOut('quad') }),
    holdTail(0.5),
]);
