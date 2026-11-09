import { Axes2d, PointsPlot } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's HeatDiagramPlot: a line through measured points on labelled axes, the
 * x axis sitting on the bottom edge because zero is out of the y range's middle.
 */
const line = createRef<PointsPlot>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Axes2d, {
            width: 760,
            height: 420,
            padding: 48,
            fontFamily: 'Inter',
            xRange: [0, 40],
            yRange: [-8, 32],
            xStep: 5,
            yStep: 5,
            xLabel: 'ΔQ',
            yLabel: 'T [°C]',
            children: [
                el(PointsPlot, {
                    ref: line,
                    end: 0,
                    points: [{ x: 0, y: 20 }, { x: 8, y: 0 }, { x: 38, y: 0 }, { x: 39, y: -5 }],
                    stroke: { weight: 4, fill: '#facc15', align: 'center', join: 'round', cap: 'round' },
                }),
            ],
        }),
    );
}, [
    () => line().progressTo({ data: { end: 1 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(0.6),
]);
