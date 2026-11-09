import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Rect.overlay}: a grain texture painted over the node's own fill *and*
 * its children, but still under the stroke — fading in to reveal the layering
 * order without touching `fill` or the child rects underneath.
 */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: 'card',
                stroke: { weight: 4, fill: 'primary' },
                overlay: Fills.noise({ color: '#000000', density: 0.6, opacity: 0 }),
                flow: 'horizontal',
                gap: 20,
                padding: 24,
                align: { x: 0, y: 0 },
                children: [
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#e8617c' }),
                    el(Rect, { width: 'fill', height: 'fill', cornerRadius: 12, fill: '#6990dd' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().overlayTo({ data: Fills.noise({ color: '#000000', density: 0.6, opacity: 0.5 }), duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
