import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link easeInOut}`('circ')`: a card slides across with the circular-curve's distinctively steep, near-instant middle transition. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: card, width: 120, height: 120, cornerRadius: 16, fill: 'primary', center: { x: -300, y: 0 } }),
    );
}, [
    () => card().to({ data: { x: 300 }, duration: 1.2, easing: easeInOut('circ') }),
    0.2,
    holdTail(1.4),
]);
