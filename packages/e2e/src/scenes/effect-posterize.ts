import { Rect, Fills, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.posterize}: a smooth gradient flattens into bands as `levels` drops from many levels to just a few. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: Fills.linearGradient(['#0d0f15', '#f4f6ff']),
                effects: Effects.posterize(64),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.posterize(3) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
