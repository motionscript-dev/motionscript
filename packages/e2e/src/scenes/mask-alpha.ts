import { MaskGroup, Ellipse, Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link MaskGroup} in `'alpha'` mode: the mask shape's rendered alpha — here a radial gradient fading to transparent — drives the content's visibility, producing a soft-edged reveal instead of a hard clip. */
const mask = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(MaskGroup, { mode: 'alpha', width: 'fill', height: 'fill', children: [
            el(Ellipse, { ref: mask, width: 120, height: 120, fill: Fills.radialGradient(['#ffffff', '#ffffff00']) }),
            el(Rect, { width: 400, height: 260, cornerRadius: 20, fill: Fills.linearGradient(['#28d6c8', '#e83fd6']) }),
        ] }),
    );
}, [
    () => mask().to({ data: { width: 520, height: 520 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
