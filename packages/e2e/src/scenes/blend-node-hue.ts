import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Node2D-level `blend`: a magenta circle isolates and blends against a cyan backdrop via `'hue'`, taking the circle's hue while keeping the backdrop's saturation and luminosity. */
const circle = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 360, height: 360, fill: '#28d6c8', center: { x: -60, y: 0 } }),
            el(Rect, {
                ref: circle,
                width: 300,
                height: 300,
                cornerRadius: 150,
                fill: '#e83fd6',
                center: { x: 60, y: 0 },
                blend: 'normal',
            }),
        ] }),
    );
}, [
    0.3,
    () => circle().to({ data: { blend: 'hue' }, duration: 0.9, easing: undefined }),
    holdTail(1.2),
]);
