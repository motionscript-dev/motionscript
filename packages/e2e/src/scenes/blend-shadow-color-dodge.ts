import { Rect, Fills } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Shadow-level `blend`: a card's drop shadow *fill* blends against the backdrop beneath it via `'color-dodge'`, brightening the overlap based on the shadow's color. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: '#0d0f15' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 360, height: 360, fill: '#1f5f8b', center: { x: 0, y: 0 } }),
            el(Rect, {
                ref: card,
                width: 200,
                height: 140,
                cornerRadius: 16,
                fill: '#0d0f15',
                center: { x: 0, y: 0 },
                shadow: { offset: { x: 40, y: 40 }, blur: 30, fill: Fills.color('#8b1f5f', { blend: 'normal' }) },
            }),
        ] }),
    );
}, [
    0.3,
    () => card().to({ data: { shadow: { offset: { x: 40, y: 40 }, blur: 30, fill: Fills.color('#8b1f5f', { blend: 'color-dodge' }) } }, duration: 0.9, easing: undefined }),
    holdTail(1.2),
]);
