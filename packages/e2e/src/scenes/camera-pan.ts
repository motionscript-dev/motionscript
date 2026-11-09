import { Camera, Rect, Ellipse, Fills } from '@motionscript/sdk';
import { GridPattern } from '@motionscript/patterns';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Camera pan: the `lookAt` (world-space focus point) slides laterally while
 * `zoom` and `heading` stay fixed, so the grid and the landmark shapes scroll
 * across the viewport. The mid frame catches the world part-way through the
 * pan, with different shapes framed than at the start.
 */
const camera = createRef<Camera>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Camera, {
            ref: camera,
            width: 'fill',
            height: 'fill',
            zoom: 1,
            heading: 0,
            lookAt: { x: -260, y: 0 },
            children: [
                el(GridPattern, {
                    cellSize: 120,
                    subdivisions: 2,
                    fill: Fills.color('bg'),
                    stroke: { weight: 3, fill: Fills.color('primary', { opacity: 0.5 }) },
                    subStroke: { weight: 1.5, fill: Fills.color('primary', { opacity: 0.25 }) },
                }),
                el(Rect, { width: 150, height: 150, cornerRadius: 20, fill: 'primary', x: -260, y: -30 }),
                el(Ellipse, { width: 150, height: 150, fill: 'accent', x: 0, y: 60 }),
                el(Rect, { width: 150, height: 150, cornerRadius: 20, fill: '#F5C26B', x: 260, y: -30 }),
            ],
        }),
    );
}, [
    // Pan only the lookAt: from the left landmark across to the right one.
    () => camera().to({ data: { lookAt: { x: 260, y: 0 } }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
