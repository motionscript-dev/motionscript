import { Axes2d, FunctionPlot, PlotPoint, PointsPlot } from '@motionscript/math';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's PolygonOnAxes: a rectangle under the hyperbola y = 25 / x whose corner
 * rides the curve. Every corner is a formula of one variable, so the rectangle
 * keeps its area as that variable moves.
 */
// A formula may sit at any depth of a prop; el's types only know the top level.
const CORNERS = [{ x: 0, y: 0 }, { x: '=[t]', y: 0 }, { x: '=[t]', y: '=25/[t]' }, { x: 0, y: '=25/[t]' }] as unknown as { x: number; y: number }[];

export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('t', 5);
    stage.add(
        el(Axes2d, {
            width: 520,
            height: 460,
            padding: 40,
            fontFamily: 'Inter',
            xRange: [0, 10],
            yRange: [0, 10],
            xStep: 2,
            yStep: 2,
            children: [
                el(PointsPlot, {
                    closed: true,
                    points: CORNERS,
                    fill: { type: 'solid', color: '#6990dd', opacity: 0.45 },
                    stroke: { weight: 3, fill: '#facc15', align: 'center', join: 'round' },
                }),
                el(FunctionPlot, {
                    expression: '25 / x',
                    domain: [2.5, 10],
                    stroke: { weight: 3, fill: 'primary', align: 'center', join: 'round' },
                }),
                el(PlotPoint, { on: 'functionPlot0', x: '=[t]', radius: 8, fill: 'white' }),
            ],
        }),
    );
}, [
    () => variableTo('t', 10, 0.8, easeInOut('quad')),
    () => variableTo('t', 2.5, 1, easeInOut('quad')),
    () => variableTo('t', 5, 0.6, easeInOut('quad')),
    holdTail(0.4),
]);
