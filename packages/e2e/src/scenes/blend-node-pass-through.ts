import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Node2D-level `blend`: a translucent group fades from `'pass-through'` (the
 * default — not isolated, opacity scales each child while they blend directly
 * against the backdrop) to `'difference'` (isolated — children flatten into
 * one layer first, then that flat result blends against the backdrop), changing
 * how the two overlapping child circles interact with the background.
 */
const group = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 360, height: 360, fill: '#28d6c8', center: { x: -100, y: 0 } }),
            el(Rect, {
                ref: group,
                width: 400,
                height: 260,
                opacity: 0.6,
                flow: 'freeform',
                align: { x: 0, y: 0 },
                blend: 'pass-through',
                children: [
                    el(Rect, { width: 220, height: 220, cornerRadius: 110, fill: '#e83fd6', center: { x: -50, y: 0 } }),
                    el(Rect, { width: 220, height: 220, cornerRadius: 110, fill: '#f2c94c', center: { x: 50, y: 0 } }),
                ],
            }),
        ] }),
    );
}, [
    0.3,
    () => group().to({ data: { blend: 'difference' }, duration: 0.9, easing: undefined }),
    holdTail(1.2),
]);
