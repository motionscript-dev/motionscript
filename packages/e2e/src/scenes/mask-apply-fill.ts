import { MaskGroup, Ellipse, Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link MaskGroup} clipping a card's combined fill and stroke down to a growing circular window. */
const mask = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(MaskGroup, { mode: 'vector', width: 'fill', height: 'fill', children: [
            el(Ellipse, { ref: mask, width: 100, height: 100, fill: '#ffffff' }),
            el(Rect, {
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: 'primary',
                stroke: { weight: 10, align: 'inside', fill: '#f4f6ff' },
            }),
        ] }),
    );
}, [
    () => mask().to({ data: { width: 320, height: 320 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
