import { MaskGroup, Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link MaskGroup} in `'luminance'` mode: the mask's brightness (not alpha) drives content visibility — a grayscale gradient mask reveals content brightest where the gradient is white, hides it where the gradient is black. */
const mask = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(MaskGroup, { mode: 'luminance', width: 'fill', height: 'fill', children: [
            el(Rect, {
                ref: mask,
                width: 500,
                height: 300,
                fill: Fills.linearGradient(['#000000', '#ffffff'], { start: { x: -250, y: 0 }, end: { x: 250, y: 0 } }),
            }),
            el(Rect, { width: 500, height: 300, cornerRadius: 20, fill: Fills.linearGradient(['#28d6c8', '#e83fd6']) }),
        ] }),
    );
}, [
    () => mask().to({ data: { fill: Fills.linearGradient(['#ffffff', '#000000'], { start: { x: -250, y: 0 }, end: { x: 250, y: 0 } }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
