import { Axes2d, FunctionPlot } from '@motionscript/math';
import { Ellipse, Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Axes with two plots in their graph coordinates, a dot and a label placed by
 * graph `x`/`y`, and the window of values panned and zoomed: everything inside
 * follows the range.
 */
const axes = createRef<Axes2d>();
const sine = createRef<FunctionPlot>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Axes2d, {
            ref: axes,
            width: 820,
            height: 460,
            padding: 36,
            xRange: [-7, 7],
            yRange: [-2, 2],
            xLabel: 'x',
            yLabel: 'y',
            fontFamily: 'Inter',
            children: [
                el(FunctionPlot, { ref: sine, expression: 'sin(x)', end: 0 }),
                el(FunctionPlot, {
                    expression: '1/x',
                    stroke: { weight: 3, fill: 'accent', align: 'center', cap: 'round', join: 'round' },
                }),
                el(Ellipse, { x: Math.PI / 2, y: 1, width: 18, height: 18, fill: 'primary' }),
                el(Text, {
                    x: Math.PI / 2,
                    y: 1.45,
                    text: '(π/2, 1)',
                    fontSize: 22,
                    fontFamily: 'Inter',
                    fill: 'white',
                }),
            ],
        }),
    );
}, [
    () => sine().progressTo({ data: { end: 1 }, duration: 0.8, easing: easeInOut('quad') }),
    () => axes().rangeTo({ data: { xRange: [-2, 5], yRange: [-1.5, 1.5] }, duration: 1, easing: easeInOut('quad') }),
    holdTail(0.6),
]);
