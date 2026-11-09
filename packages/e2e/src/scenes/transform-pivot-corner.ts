import { Rect } from '@motionscript/sdk';
import { createRef, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect.pivot} set to a corner (`{x:0, y:1}` in unit space — top-left): rotation now swings the card around that corner instead of its center, like a page turning. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            ref: card,
            width: 240,
            height: 120,
            cornerRadius: 16,
            fill: 'primary',
            pivot: { x: 0, y: 1 },
            rotation: 0,
        }),
    );
}, [
    () => card().to({ data: { rotation: 360 }, duration: 1.6, easing: linear() }),
    holdTail(1.6),
]);
