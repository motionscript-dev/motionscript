import { Camera, Rect, Ellipse, Fills } from '@motionscript/sdk';
import { GridPattern } from '@motionscript/patterns';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Camera combined: `zoom`, `origin`, and `heading` all animate together in a
 * single tween, so the viewport simultaneously dollies in, pans toward a
 * landmark, and rolls. The mid frame catches every channel part-way, a pose
 * distinct from both the wide start and the tight, tilted finish.
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
            lookAt: { x: 0, y: 0 },
            children: [
                el(GridPattern, {
                    cellSize: 120,
                    subdivisions: 2,
                    fill: Fills.color('bg'),
                    stroke: { weight: 3, fill: Fills.color('primary', { opacity: 0.5 }) },
                    subStroke: { weight: 1.5, fill: Fills.color('primary', { opacity: 0.25 }) },
                }),
                el(Rect, { width: 150, height: 150, cornerRadius: 20, fill: 'primary', x: -220, y: -40 }),
                el(Ellipse, { width: 150, height: 150, fill: 'accent', x: 210, y: 140 }),
                el(Rect, { width: 130, height: 130, cornerRadius: 20, fill: '#F5C26B', x: 150, y: -160 }),
            ],
        }),
    );
}, [
    // All three viewport channels move at once: dolly in, pan to the accent
    // ellipse, and roll the view.
    () => camera().to({ data: { zoom: 2.2, lookAt: { x: 210, y: 140 }, heading: 30 }, duration: 1.5, easing: easeInOut('quad') }),
    holdTail(1.5),
]);
