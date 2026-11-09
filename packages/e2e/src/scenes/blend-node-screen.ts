import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Node2D-level `blend`: a magenta circle isolates and blends against a cyan backdrop via `'screen'`, lightening the overlap. */
const circle = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: '#0d0f15' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 360, height: 360, fill: '#1f5f8b', center: { x: -60, y: 0 } }),
            el(Rect, {
                ref: circle,
                width: 300,
                height: 300,
                cornerRadius: 150,
                fill: '#8b1f5f',
                center: { x: 60, y: 0 },
                blend: 'normal',
            }),
        ] }),
    );
}, [
    0.3,
    () => circle().to({ data: { blend: 'screen' }, duration: 0.9, easing: undefined }),
    holdTail(1.2),
]);
