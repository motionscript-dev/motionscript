import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Fills.stripe}: a hatch fill whose `angle` sweeps from diagonal to vertical. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: [...Fills.color('card'), ...Fills.stripe({ gap: 10, strokeWidth: 4, angle: -45, color: 'primary' })],
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: [...Fills.color('card'), ...Fills.stripe({ gap: 10, strokeWidth: 4, angle: 90, color: 'primary' })] }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
