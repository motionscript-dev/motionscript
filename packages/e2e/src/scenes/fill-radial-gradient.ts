import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Fills.radialGradient}: the glow radius grows from a tight pool of light to filling the shape. */
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
                fill: Fills.radialGradient(['#f2c94c', '#23283a'], { radius: 30 }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: Fills.radialGradient(['#f2c94c', '#23283a'], { radius: 280 }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
