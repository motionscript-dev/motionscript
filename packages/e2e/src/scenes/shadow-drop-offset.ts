import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Drop shadow whose OFFSET sweeps from up-left to down-right while blur stays
 * fixed, so the moving offset is the only visible variable.
 */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 300,
                height: 300,
                cornerRadius: 28,
                fill: 'card',
                shadow: { blur: 18, offset: { x: -40, y: -40 }, fill: Fills.color('#000000', { opacity: 0.7 }) },
            }),
        ] }),
    );
}, [
    () => card().to({ data: { shadow: { blur: 18, offset: { x: 40, y: 40 }, fill: Fills.color('#000000', { opacity: 0.7 }) } }, duration: 1.4, easing: easeInOut('sine') }),
    holdTail(1.4),
]);
