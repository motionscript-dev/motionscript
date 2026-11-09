import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `join: 'bevel'`: corners are flattened into a short straight cut instead of a sharp point, more visible as the stroke thickens. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 260,
                height: 260,
                fill: 'card',
                stroke: { weight: 10, fill: 'primary', join: 'bevel' },
            }),
        ] }),
    );
}, [
    () => rect().strokeTo({ data: { weight: 70, fill: 'primary', join: 'bevel' }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
