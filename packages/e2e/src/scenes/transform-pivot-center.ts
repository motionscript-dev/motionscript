import { Rect } from '@motionscript/sdk';
import { createRef, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/** Default pivot (the node's center): rotation spins the card in place around its own midpoint. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: card, width: 240, height: 120, cornerRadius: 16, fill: 'primary', rotation: 0 }),
    );
}, [
    () => card().to({ data: { rotation: 360 }, duration: 1.6, easing: linear() }),
    holdTail(1.6),
]);
