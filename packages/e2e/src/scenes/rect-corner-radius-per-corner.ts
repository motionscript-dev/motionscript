import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Rect animating an asymmetric, per-corner radius: only the top-left and
 * bottom-right corners round, while the other two stay sharp — exercising the
 * `{ topLeft, topRight, bottomLeft, bottomRight }` corner-radius input form.
 */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 300,
                height: 300,
                fill: 'primary',
                cornerRadius: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { cornerRadius: { topLeft: 120, topRight: 0, bottomLeft: 0, bottomRight: 120 } }, duration: 1.3, easing: easeInOut('quad') }),
    holdTail(1.3),
]);
