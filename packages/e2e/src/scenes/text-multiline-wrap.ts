import { Rect, Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A wrapped paragraph in a fixed-width box. Animating the box `width` narrower
 * forces the text to re-flow onto more lines, so the wrap is visibly exercised
 * (the mid frame catches the paragraph mid-reflow).
 */
const box = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });

    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: box,
                width: 620,
                height: 360,
                cornerRadius: 20,
                fill: 'card',
                flow: 'freeform',
                align: { x: 0, y: 0 },
                padding: 40,
                children: [
                    el(Text, {
                        text: 'Motion Script lays out wrapped text one line at a time, breaking on word boundaries to fit the box.',
                        fontFamily: 'Inter',
                        fontSize: 40,
                        fontWeight: 500,
                        fill: '#f4f6ff',
                        width: 'fill',
                        wrap: true,
                        textAlign: 'start',
                    }),
                ],
            }),
        ] }),
    );
}, [
    () => box().to({ data: { width: 320 }, duration: 1.3, easing: easeInOut('quad') }),
    holdTail(1.3),
]);
