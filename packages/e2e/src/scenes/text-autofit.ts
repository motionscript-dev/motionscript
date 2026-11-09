import { Rect, Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Text} `fontSize: 'autofit'`: the glyph size scales to fill its box
 * automatically. Shrinking the box forces the same text to shrink with it,
 * down to `minFontSize`.
 */
const box = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: box,
                width: 700,
                height: 260,
                cornerRadius: 16,
                fill: 'card',
                padding: 20,
                flow: 'freeform',
                align: { x: 0, y: 0 },
                children: [
                    el(Text, {
                        text: 'Autofit',
                        fontFamily: 'Inter',
                        fontWeight: 800,
                        fontSize: 'autofit',
                        minFontSize: 12,
                        fill: 'primary',
                        width: 'fill',
                        height: 'fill',
                    }),
                ],
            }),
        ] }),
    );
}, [
    () => box().to({ data: { width: 260, height: 120 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
