import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `width: 'fill', height: 'fill'`: a child stretches to fill its padded
 * parent, then tracks the parent as it resizes — confirming `'fill'` is
 * computed relative to the live content box, not a one-time snapshot.
 */
const parent = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: parent, width: 300, height: 460, fill: 'card', cornerRadius: 16, padding: 20, children: [
            el(Rect, { width: 'fill', height: 'fill', fill: 'primary', cornerRadius: 8 }),
        ] }),
    );
}, [
    () => parent().to({ data: { width: 700, height: 220 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
