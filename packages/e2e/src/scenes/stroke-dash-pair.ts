import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `dash: [on, off]`: an explicit two-number pair gives uneven dash/gap lengths, here animating from short dashes/long gaps to long dashes/short gaps. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 360,
                height: 240,
                cornerRadius: 16,
                fill: 'card',
                stroke: { weight: 6, fill: 'primary', dash: [8, 32] },
            }),
        ] }),
    );
}, [
    () => rect().strokeTo({ data: { weight: 6, fill: 'primary', dash: [32, 8] }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
