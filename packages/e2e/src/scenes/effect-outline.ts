import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.outline}: a band grows outward from the glyph silhouette as `width` ramps up. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Text, {
                ref: label,
                text: 'EDGE',
                fontFamily: 'Inter',
                fontWeight: 800,
                fontSize: 120,
                fill: '#f4f6ff',
                effects: Effects.outline({ width: 0, color: 'accent' }),
            }),
        ] }),
    );
}, [
    () => label().to({ data: { effects: Effects.outline({ width: 14, color: 'accent' }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
