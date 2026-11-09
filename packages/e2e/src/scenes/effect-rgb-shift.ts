import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Effects.rgbShift}: the red and blue planes pull apart horizontally, green stays put. */
const label = createRef<Text>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Text, {
                ref: label,
                text: 'SIGNAL',
                fontFamily: 'Inter',
                fontWeight: 800,
                fontSize: 96,
                fill: '#f4f6ff',
                effects: Effects.rgbShift(0),
            }),
        ] }),
    );
}, [
    () => label().to({ data: { effects: Effects.rgbShift(20) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
