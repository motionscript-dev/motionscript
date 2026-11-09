import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `Effects.pixelate({ blocks, sharpColors: false })`: with `sharpColors` off,
 * each mosaic block averages its source area smoothly instead of snapping to a
 * single solid sample — softer than the default "Sharp Colors" look.
 */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 320,
                height: 320,
                cornerRadius: 20,
                fill: 'card',
                flow: 'horizontal',
                gap: 0,
                effects: Effects.pixelate({ blocks: 64, sharpColors: false }),
                children: [
                    el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
                    el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
                    el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.pixelate({ blocks: 8, sharpColors: false }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
