import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link easeInOut}`('back')`: a card slides across, overshooting past its target before settling back — the signature "anticipation" curve. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: card, width: 120, height: 120, cornerRadius: 16, fill: 'primary', center: { x: -300, y: 0 } }),
    );
}, [
    () => card().to({ data: { x: 300 }, duration: 1.2, easing: easeInOut('back') }),
    0.2,
    holdTail(1.4),
]);
