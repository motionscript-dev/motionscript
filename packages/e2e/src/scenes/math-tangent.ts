import { Axes2d, FunctionPlot, NumberLine, PlotPoint, TangentLine } from '@motionscript/math';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * A tangent riding a curve and a secant with its run and rise, inside the plot
 * they follow and driven by one variable, over a number line whose own dot
 * follows the same value.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('t', -2);
    stage.add(
        el(Axes2d, {
            y: 50,
            width: 760,
            height: 380,
            padding: 36,
            fontFamily: 'Inter',
            xRange: [-4, 4],
            yRange: [-1.5, 3],
            children: [
                el(FunctionPlot, {
                    expression: 'x^2 / 3 - 1',
                    stroke: { weight: 3, fill: 'primary', align: 'center', join: 'round' },
                    children: [
                        el(TangentLine, { x: '=[t]', length: 240 }),
                        el(TangentLine, {
                            x: -3.5,
                            dx: 1.5,
                            legs: true,
                            length: 200,
                            stroke: { weight: 2, fill: 'accent', align: 'center', join: 'round' },
                        }),
                        el(PlotPoint, { x: '=[t]', radius: 7, fill: 'white' }),
                    ],
                }),
            ],
        }),
    );
    stage.add(
        el(NumberLine, {
            y: -210,
            width: 760,
            height: 70,
            padding: { left: 36, right: 36 },
            fontFamily: 'Inter',
            range: [-4, 4],
            step: 1,
            longTicks: [0],
            children: [
                el(PlotPoint, { x: '=[t]', y: 0, radius: 8, fill: '#f59e0b' }),
            ],
        }),
    );
}, [
    () => variableTo('t', 2.5, 1.8, easeInOut('quad')),
    holdTail(0.5),
]);
