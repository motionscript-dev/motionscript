import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Fills.noise}: grain density ramping from sparse to dense. */
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
                fill: Fills.noise({ color: '#f4f6ff', density: 0.05 }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.noise({ color: '#f4f6ff', density: 1 }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
