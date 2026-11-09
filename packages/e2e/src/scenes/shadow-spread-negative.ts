import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Negative `shadow.spread` shrinks the shadow's silhouette before it is offset and blurred, pulling it inward from the shape's edge. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 300,
                height: 200,
                cornerRadius: 20,
                fill: '#f4f6ff',
                shadow: { blur: 24, offset: { x: 0, y: 0 }, fill: '#000000', spread: 0 },
            }),
        ] }),
    );
}, [
    () => card().to({ data: { shadow: { blur: 24, offset: { x: 0, y: 0 }, fill: '#000000', spread: -60 } }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
