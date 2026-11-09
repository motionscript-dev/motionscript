import { MaskGroup, Ellipse, Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link MaskGroup}'s `inverted` flag flipping the mask to subtract mode: content shows everywhere the mask shape is NOT, so a growing circle now punches a hole instead of opening a window. */
const mask = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(MaskGroup, { mode: 'vector', inverted: true, width: 'fill', height: 'fill', children: [
            el(Ellipse, { ref: mask, width: 80, height: 80, fill: '#ffffff' }),
            el(Rect, { width: 400, height: 260, cornerRadius: 20, fill: Fills.linearGradient(['#28d6c8', '#e83fd6']) }),
        ] }),
    );
}, [
    () => mask().to({ data: { width: 260, height: 260 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
