import { FunctionPlot, PlotPoint, PolarPlane, TracedPath } from '@motionscript/math';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's PolarPlane and TracedPath: a rose on rings and spokes, and the trail
 * a point leaves along a spiral as one variable is driven.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('t', 0);
    stage.add(
        el(PolarPlane, { width: 520, height: 480, radius: 3, fontFamily: 'Inter', angleUnit: 'radians', children: [
            el(FunctionPlot, {
                expression: 'r = 2.5 cos(3theta)',
                stroke: { weight: 3, fill: 'primary', align: 'center', join: 'round' },
            }),
            el(TracedPath, {
                expression: '(t cos(3t) / 2.2, t sin(3t) / 2.2)',
                value: '=[t]',
                stroke: { weight: 3, fill: '#facc15', align: 'center', cap: 'round', join: 'round' },
            }),
            el(PlotPoint, { x: '=[t] * cos(3 * [t]) / 2.2', y: '=[t] * sin(3 * [t]) / 2.2', radius: 7, fill: 'white' }),
        ] }),
    );
}, [
    () => variableTo('t', 6.28, 2.0, easeInOut('quad')),
    holdTail(0.4),
]);
