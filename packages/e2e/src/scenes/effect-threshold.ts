import { Rect, Fills, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.threshold}: a gradient collapses to two tones, the cut sweeping across as `level` rises. */
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
                effects: Effects.threshold({ level: 0.15, smoothness: 0.02 }),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.threshold({ level: 0.75, smoothness: 0.02 }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
