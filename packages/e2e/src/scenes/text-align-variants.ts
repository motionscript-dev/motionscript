import { Rect, Text } from '@motionscript/sdk';
import { cmd, createRef, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Cycles one wrapped paragraph through every `textAlign` value — start, center,
 * end, justify — switching every ~0.4s. `textAlign` is an enum so each change
 * is an instant `set`; the mid frame lands on one of the centered/justified
 * modes so the alignment difference is visible.
 */
const para = createRef<Text>();
const label = createRef<Text>();

/** Hold one alignment for `0.4s`: two stamps, placed together, that take the step's whole slot. */
const show = (align: 'start' | 'center' | 'end' | 'justify') => [
    () => cmd(label, 'set', { text: align }, 0.4),
    () => cmd(para, 'set', { textAlign: align }, 0.4),
];

export default scene((stage) => {
    stage.set({ fill: 'bg' });

    const text =
        'Each line of this wrapped paragraph sits inside the box according to the current textAlign mode.';

    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                width: 680,
                height: 400,
                cornerRadius: 20,
                fill: 'card',
                flow: 'vertical',
                gap: 20,
                padding: 40,
                children: [
                    el(Text, {
                        ref: label,
                        text: 'start',
                        fontFamily: 'Inter',
                        fontSize: 28,
                        fontWeight: 700,
                        fill: 'primary',
                        width: 'fill',
                        textAlign: 'start',
                    }),
                    el(Text, {
                        ref: para,
                        text,
                        fontFamily: 'Inter',
                        fontSize: 36,
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
    show('start'),
    show('center'),
    show('end'),
    show('justify'),
    holdTail(1.6),
]);
