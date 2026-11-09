import { Axes3d, PlotPoint3d, SurfacePlot3d, VectorArrow3d } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's ThreeDSurfacePlot: a Gaussian bump over 3D axes, coloured by height,
 * with a point riding it and an arrow to that point. The bump then flattens
 * into a saddle while the view swings round. The axes are the viewport: they
 * carry the camera.
 */
const view = createRef<Axes3d>();
const surface = createRef<SurfacePlot3d>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Axes3d, {
            ref: view,
            width: 640,
            height: 460,
            zoom: 11,
            fill: [],
            fontFamily: 'Inter',
            labels: true,
            grid: true,
            children: [
                el(SurfacePlot3d, {
                    ref: surface,
                    expression: '1.8 exp(-(x^2 + y^2) / 2)',
                    colorScale: ['#1d4ed8', '#22c55e', '#facc15', '#ef4444'],
                    opacity: 0.92,
                    children: [
                        el(PlotPoint3d, { x: 0.8, y: -0.6, fill: 'white', label: 'P', fontFamily: 'Inter' }),
                    ],
                }),
                el(VectorArrow3d, { head: { x: 2, y: 2, z: 1.5 }, fill: '#f97316' }),
            ],
        }),
    );
}, [
    () => view().orbitTo({ data: { orbit: 80, elevation: 32 }, duration: 1.2, easing: easeInOut('quad') }),
    () => surface().morphTo({ data: { expression: '(x^2 - y^2) / 5' }, duration: 1.0, easing: easeInOut('quad') }),
    holdTail(0.4),
]);
