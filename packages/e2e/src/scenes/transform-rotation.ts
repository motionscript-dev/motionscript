import { Rect } from '@motionscript/sdk';
import { createRef, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/** A shape spinning a full rotation around its center. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { ref: rect, width: 220, height: 220, cornerRadius: 24, fill: 'accent', rotation: 0 }),
        ] }),
    );
}, [
    () => rect().to({ data: { rotation: 360 }, duration: 1.8, easing: linear() }),
    holdTail(1.8),
]);
