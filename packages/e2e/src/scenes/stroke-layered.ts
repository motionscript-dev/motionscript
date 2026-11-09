import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A node's `stroke` accepts an array: a thick outer band plus a thin inner accent line, stacked bottom-to-top, both thickening together. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 300,
                height: 300,
                cornerRadius: 24,
                fill: 'card',
                stroke: [
                    { weight: 10, fill: 'primary', align: 'inside' },
                    { weight: 2, fill: '#f4f6ff', align: 'inside' },
                ],
            }),
        ] }),
    );
}, [
    () => rect().to({ data: {
            stroke: [
                { weight: 36, fill: 'primary', align: 'inside' },
                { weight: 2, fill: '#f4f6ff', align: 'inside' },
            ] }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
