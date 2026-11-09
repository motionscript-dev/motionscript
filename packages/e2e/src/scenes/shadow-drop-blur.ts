import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Drop shadow `blur` alone sharpening from a soft, wide haze down to a crisp, tight edge. */
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
                shadow: { blur: 80, offset: { x: 0, y: 16 }, fill: '#000000' },
            }),
        ] }),
    );
}, [
    () => card().to({ data: { shadow: { blur: 2, offset: { x: 0, y: 16 }, fill: '#000000' } }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
