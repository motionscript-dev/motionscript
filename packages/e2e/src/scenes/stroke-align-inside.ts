import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `align: 'inside'` (-1) keeps the whole stroke band within the shape's
 * measured bounds, like a CSS border. We grow the weight so the band thickens
 * *inward* from the edge — the outer silhouette (350x350) never changes.
 */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 350,
                height: 350,
                fill: 'card',
                stroke: { weight: 4, fill: 'primary', align: 'inside' },
            }),
        ] }),
    );
}, [
    // Thicken the inside band: outer edge holds, fill area shrinks inward.
    () => rect().strokeTo({ data: { weight: 48, fill: 'primary', align: 'inside' }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
