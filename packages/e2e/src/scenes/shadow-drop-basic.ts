import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A basic drop shadow whose blur + offset grow as the card lifts off the surface. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 320,
                height: 220,
                cornerRadius: 20,
                fill: '#f4f6ff',
                shadow: { blur: 4, offset: { x: 0, y: 2 }, fill: '#000000' },
            }),
        ] }),
    );
}, [
    () => card().to({ data: { shadow: { blur: 48, offset: { x: 0, y: 32 }, fill: '#000000' } }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
