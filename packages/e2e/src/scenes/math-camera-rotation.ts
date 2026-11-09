import { Axes3d, CurvePlot3d, PlotPoint3d } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's ThreeDCameraRotation: axes and a circle on the floor, seen as the
 * camera circles them. A helix is then drawn on above the circle, a point at
 * its foot.
 */
const view = createRef<Axes3d>();
const helix = createRef<CurvePlot3d>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Axes3d, {
            ref: view,
            width: 640,
            height: 460,
            zoom: 11,
            orbit: 20,
            elevation: 24,
            ambientIntensity: 0.9,
            fill: [],
            fontFamily: 'Inter',
            xRange: [-3, 3],
            yRange: [-3, 3],
            zRange: [0, 4],
            xLabel: '',
            yLabel: '',
            zLabel: '',
            children: [
                el(CurvePlot3d, { expression: '(2cos(t), 2sin(t), 0)', domain: [0, 6.2832], fill: '#ef4444' }),
                el(CurvePlot3d, {
                    ref: helix,
                    expression: '(2cos(t), 2sin(t), t / 4)',
                    domain: [0, 12.566],
                    end: 0,
                    thickness: 0.05,
                }),
                el(PlotPoint3d, { x: 2, y: 0, z: 0, fill: 'white' }),
            ],
        }),
    );
}, [
    () => view().orbitTo({ data: { orbit: 110 }, duration: 1.4, easing: easeInOut('quad') }),
    () => helix().progressTo({ data: { end: 1 }, duration: 1.0, easing: easeInOut('quad') }),
    holdTail(0.4),
]);
