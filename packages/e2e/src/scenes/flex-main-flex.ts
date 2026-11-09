import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Per-child `flex` weight along the main axis: the middle child starts at
 * weight 1 (sharing space evenly with its fixed-weight siblings) and grows to
 * weight 4, eating most of the row's width while the others shrink to match.
 */
const middle = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { flow: 'horizontal', width: 760, height: 200, gap: 16, children: [
            el(Rect, { flex: 1, height: 'fill', fill: 'primary', cornerRadius: 12 }),
            el(Rect, { ref: middle, flex: 1, height: 'fill', fill: 'accent', cornerRadius: 12 }),
            el(Rect, { flex: 1, height: 'fill', fill: 'primary', cornerRadius: 12 }),
        ] }),
    );
}, [
    () => middle().to({ data: { flex: 4 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
