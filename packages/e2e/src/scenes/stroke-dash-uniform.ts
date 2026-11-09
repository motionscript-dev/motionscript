import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `dash: n` — a single number becomes `[n, n]`, an even dash/gap pattern, growing from fine to coarse. */
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
                stroke: { weight: 6, fill: 'primary', dash: 4 },
            }),
        ] }),
    );
}, [
    () => rect().strokeTo({ data: { weight: 6, fill: 'primary', dash: 28 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
