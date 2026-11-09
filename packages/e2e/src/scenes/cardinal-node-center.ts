import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { PinnedEllipse } from '@/components/pinned';
import { holdTail } from './_lib';

/**
 * Cardinal points: a marker dot is pinned to the `center` of a moving card via a
 * reactive accessor, so it tracks the card's center as the card animates.
 */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add([
        el(Rect, { ref: card, width: 300, height: 200, cornerRadius: 18, fill: 'card', x: -200 }),
        el(PinnedEllipse, { width: 36, height: 36, fill: 'accent', pin: 'center', on: 'rect0' }),
    ]);
}, [
    () => card().to({ data: { x: 200, rotation: 20 }, duration: 1.4, easing: easeInOut('cubic') }),
    holdTail(1.4),
]);
