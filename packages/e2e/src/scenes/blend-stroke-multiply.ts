import { Rect, Fills } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Stroke-level `blend`: a thick circle outline's stroke *fill* blends against the card beneath it via `'multiply'`, darkening the overlap based on the stroke's color. */
const circle = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 360, height: 360, fill: '#28d6c8', center: { x: -60, y: 0 } }),
            el(Rect, {
                ref: circle,
                width: 260,
                height: 260,
                cornerRadius: 130,
                stroke: { weight: 36, align: 'center', fill: Fills.color('#e83fd6', { blend: 'normal' }) },
                center: { x: 60, y: 0 },
            }),
        ] }),
    );
}, [
    0.3,
    () => circle().strokeTo({ data: { fill: Fills.color('#e83fd6', { blend: 'multiply' }) }, duration: 0.9 }),
    holdTail(1.2),
]);
