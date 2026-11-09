import { Rect } from '@motionscript/sdk';
import { createRef, easeOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link easeOut}`('elastic')`: a card springs to its target, oscillating like a rubber band before settling. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: card, width: 120, height: 120, cornerRadius: 16, fill: 'primary', center: { x: -300, y: 0 } }),
    );
}, [
    () => card().to({ data: { x: 300 }, duration: 1.4, easing: easeOut('elastic') }),
    0.2,
    holdTail(1.6),
]);
