import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Row.align}: three uneven-height children packed against the top of a
 * tall container, then `align` animates to the bottom — repositioning every
 * child along the cross axis without changing the row's own gap or order.
 */
const row = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            flow: 'horizontal',
            ref: row,
            width: 700,
            height: 420,
            fill: 'card',
            cornerRadius: 16,
            gap: 24,
            align: 'topCenter',
            children: [
                el(Rect, { width: 100, height: 100, fill: 'primary', cornerRadius: 12 }),
                el(Rect, { width: 100, height: 220, fill: 'accent', cornerRadius: 12 }),
                el(Rect, { width: 100, height: 150, fill: 'primary', cornerRadius: 12 }),
            ],
        }),
    );
}, [
    () => row().to({ data: { align: 'bottomCenter' }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
