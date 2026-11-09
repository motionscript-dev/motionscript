import { Axes2d, FunctionPlot, PlotPoint } from '@motionscript/math';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's ArgMinExample: a parabola and a dot riding it. The dot's x follows a
 * variable, which one command drives to the curve's minimum: a ValueTracker and
 * its updater, as data.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('t', 0);
    stage.add(
        el(Axes2d, {
            width: 760,
            height: 420,
            padding: 40,
            fontFamily: 'Inter',
            xRange: [0, 10],
            yRange: [0, 100],
            xStep: 1,
            yStep: 10,
            children: [
                el(FunctionPlot, {
                    expression: '2(x - 5)^2',
                    stroke: { weight: 4, fill: '#a3113e', align: 'center', join: 'round' },
                    children: [
                        el(PlotPoint, { x: '=[t]', radius: 9, fill: 'white' }),
                    ],
                }),
            ],
        }),
    );
}, [
    () => variableTo('t', 5, 1.6, easeInOut('quad')),
    holdTail(0.6),
]);
