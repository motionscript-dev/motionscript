import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.pixelate}: the block count drops from pristine (many blocks) to chunky mosaic (few blocks). */
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
                effects: Effects.pixelate(64),
                children: [
                    el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
                    el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
                    el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
                ],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: Effects.pixelate(8) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
