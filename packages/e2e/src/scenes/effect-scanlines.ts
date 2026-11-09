import { Rect, Fills, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.scanlines}: CRT bands darken across a bright card as `darkness` ramps up. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 420,
                height: 280,
                cornerRadius: 20,
                fill: Fills.linearGradient(['#7ad9ff', '#f4f6ff']),
                effects: Effects.scanlines({ darkness: 0, spacing: 8 }),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.scanlines({ darkness: 0.9, spacing: 8 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
