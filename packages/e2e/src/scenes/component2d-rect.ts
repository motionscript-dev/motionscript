import type { Node2D } from '@motionscript/sdk';
import { RectV2 } from '@/components/component-syntax';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `rect-basic`, with both rects written as `component2d`: its frames should match rect-basic's pixel for pixel. */
const rect = createRef<Node2D>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(RectV2, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(RectV2, { ref: rect, width: 320, height: 200, fill: 'primary', scale: 0.6 }),
        ] }),
    );
}, [
    () => rect().to({ data: { scale: 1 }, duration: 1, easing: easeInOut('quad') }),
    holdTail(1),
]);
