import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Rect.gap}: spacing between row children animating from tight to wide. */
const row = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { ref: row, width: 'fill', height: 200, flow: 'horizontal', align: { x: 0, y: 0 }, gap: 0, children: [
            el(Rect, { width: 120, height: 120, fill: 'primary', cornerRadius: 16 }),
            el(Rect, { width: 120, height: 120, fill: 'accent', cornerRadius: 16 }),
            el(Rect, { width: 120, height: 120, fill: 'primary', cornerRadius: 16 }),
        ] }),
    );
}, [
    () => row().to({ data: { gap: 60 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
