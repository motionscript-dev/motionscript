import { Rect, Fills, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.dither}: a gradient drops to 1-bit output, the error becoming a Bayer crosshatch. */
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
                fill: Fills.linearGradient(['#0d0f15', '#f4f6ff']),
                effects: Effects.dither({ levels: 64, matrix: 8, scale: 3 }),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.dither({ levels: 2, matrix: 8, scale: 3 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
