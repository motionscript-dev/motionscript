import { Rect } from '@motionscript/sdk';
import { createRef, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect.pivot} set to an arbitrary off-shape point, far outside the card's own bounds: rotation now orbits the card around that distant point instead of swinging in place. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            ref: card,
            width: 120,
            height: 80,
            cornerRadius: 12,
            fill: 'primary',
            pivot: { x: 3, y: 0.5 },
            rotation: 0,
        }),
    );
}, [
    () => card().to({ data: { rotation: 360 }, duration: 1.8, easing: linear() }),
    holdTail(1.8),
]);
