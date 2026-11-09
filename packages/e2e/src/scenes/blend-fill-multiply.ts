import { Rect, Fills } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Fill-level `blend`: a magenta circle's *fill* (not the node) blends against the cyan card beneath it via `'multiply'`, darkening the overlap, while the node itself stays un-isolated. */
const circle = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: '#0d0f15' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 360, height: 360, fill: '#28d6c8', center: { x: -60, y: 0 } }),
            el(Rect, {
                ref: circle,
                width: 300,
                height: 300,
                cornerRadius: 150,
                fill: Fills.color('#e83fd6', { blend: 'normal' }),
                center: { x: 60, y: 0 },
            }),
        ] }),
    );
}, [
    0.3,
    () => circle().to({ data: { fill: Fills.color('#e83fd6', { blend: 'multiply' }) }, duration: 0.9, easing: undefined }),
    holdTail(1.2),
]);
