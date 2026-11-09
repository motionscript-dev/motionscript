import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `space: 'global'`: the gradient is anchored to the render viewport, so
 * moving the node anywhere on screen changes which slice of the gradient it
 * shows through — the fill stays fixed to the frame, not the shape.
 */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 200,
                height: 200,
                cornerRadius: 20,
                x: -260,
                fill: Fills.linearGradient(['#6990dd', '#e8617c'], { space: 'global' }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { x: 260 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
