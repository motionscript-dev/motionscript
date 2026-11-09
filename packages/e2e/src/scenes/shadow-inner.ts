import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** `shadow.inner: true` casts the shadow inward (inset) instead of as a drop shadow, deepening as blur grows. */
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
                fill: 'card',
                shadow: { blur: 6, offset: { x: 0, y: 4 }, fill: '#000000', inner: true },
            }),
        ] }),
    );
}, [
    () => card().to({ data: { shadow: { blur: 40, offset: { x: 0, y: 18 }, fill: '#000000', inner: true } }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
