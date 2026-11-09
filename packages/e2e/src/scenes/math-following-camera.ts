import { Camera } from '@motionscript/sdk';
import { Axes2d, FunctionPlot, PlotPoint } from '@motionscript/math';
import { createRef, easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's FollowingGraphCamera: a dot rides a sine curve, and a camera that
 * follows it moves in on it, travels with it and pulls back out.
 */
const camera = createRef<Camera>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('t', -5);
    stage.add(
        el(Camera, { ref: camera, width: 900, height: 500, follow: 'plotPoint0', fill: 'bg', children: [
            el(Axes2d, {
                width: 860,
                height: 440,
                padding: 30,
                fontFamily: 'Inter',
                xRange: [-6, 6],
                yRange: [-2, 2],
                children: [
                    el(FunctionPlot, {
                        expression: 'sin(x)',
                        stroke: { weight: 3, fill: 'primary', align: 'center', join: 'round' },
                        children: [
                            el(PlotPoint, { x: '=[t]', radius: 8, fill: '#f59e0b' }),
                        ],
                    }),
                ],
            }),
        ] }),
    );
}, [
    () => camera().zoomTo({ data: { zoom: 2.2 }, duration: 0.7, easing: easeInOut('quad') }),
    () => variableTo('t', 5, 1.6, easeInOut('quad')),
    () => camera().zoomTo({ data: { zoom: 1 }, duration: 0.7, easing: easeInOut('quad') }),
    holdTail(0.3),
]);
