import { Axes2d, CurveArea, DropLines, FunctionPlot, RiemannSum } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's GraphAreaPlot: two curves, guides dropped from one of them at x = 2
 * and x = 3, the area between the curves over that span, and Riemann
 * rectangles under a short stretch, which then narrow.
 */
const between = createRef<CurveArea>();
const sum = createRef<RiemannSum>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Axes2d, {
            width: 640,
            height: 460,
            padding: 40,
            fontFamily: 'Inter',
            xRange: [0, 5],
            yRange: [0, 6],
            xStep: 1,
            yStep: 1,
            children: [
                el(CurveArea, {
                    ref: between,
                    on: 'functionPlot1',
                    under: 'functionPlot0',
                    domain: [2, 2.001],
                    fill: { type: 'solid', color: '#9ca3af', opacity: 0.5 },
                }),
                el(RiemannSum, { ref: sum, on: 'functionPlot0', domain: [0.3, 0.9], dx: 0.2 }),
                el(FunctionPlot, {
                    expression: '4x - x^2',
                    domain: [0, 4],
                    stroke: { weight: 3, fill: 'primary', align: 'center', join: 'round' },
                }),
                el(FunctionPlot, {
                    expression: '0.8x^2 - 3x + 4',
                    domain: [0, 4],
                    stroke: { weight: 3, fill: '#4ade80', align: 'center', join: 'round' },
                }),
                el(DropLines, {
                    on: 'functionPlot0',
                    x: 2,
                    axis: 'x',
                    stroke: { weight: 3, fill: '#facc15', align: 'center' },
                }),
                el(DropLines, {
                    on: 'functionPlot0',
                    x: 3,
                    axis: 'x',
                    stroke: { weight: 3, fill: '#facc15', align: 'center' },
                }),
            ],
        }),
    );
}, [
    () => between().domainTo({ data: { domain: [2, 3] }, duration: 0.9, easing: easeInOut('quad') }),
    () => sum().refineTo({ data: { dx: 0.03 }, duration: 0.9, easing: easeInOut('quad') }),
    holdTail(0.5),
]);
