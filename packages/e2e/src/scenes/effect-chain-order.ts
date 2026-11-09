import { Rect, Text, Effects, Fills } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Regression guard: a chain of shader effects must run in **author order**.
 *
 * The two cards carry the same two effects in opposite orders, and the result
 * is unambiguous because each effect destroys what the other would have shown:
 *
 * - left  — `bitCrush` then `threshold`: greens get cut to pure black and white.
 * - right — `threshold` then `bitCrush`: black and white snap to the two extreme
 *   greens of the DMG palette.
 *
 * If the chain ever runs backwards again the two cards swap, which no threshold
 * tuning can disguise. (They rendered identically before the fix, because
 * whichever effect ran last dictated the output.)
 */
const crush = { palette: 'gameboy' as const, amount: 1 };

export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, {
            width: 'fill',
            height: 'fill',
            flow: 'horizontal',
            gap: 40,
            padding: 60,
            align: { x: 0, y: 0 },
            children: [
                el(Rect, { width: 'fill', height: 'fill', flow: 'vertical', gap: 16, children: [
                    el(Rect, {
                        width: 'fill',
                        height: 'fill',
                        cornerRadius: 16,
                        clip: true,
                        flow: 'freeform',
                        children: [
                            el(Rect, {
                                fill: Fills.image('./cat.jpg', { fit: 'fill' }),
                                width: 'fill',
                                height: 'fill',
                                effects: Effects.bitCrush(crush).threshold({ level: 0.4, smoothness: 0.02 }),
                            }),
                        ],
                    }),
                    el(Text, { text: 'crush → threshold', fontFamily: 'Inter', fontSize: 22, fill: '#9aa4bf' }),
                ] }),
                el(Rect, { width: 'fill', height: 'fill', flow: 'vertical', gap: 16, children: [
                    el(Rect, {
                        width: 'fill',
                        height: 'fill',
                        cornerRadius: 16,
                        clip: true,
                        flow: 'freeform',
                        children: [
                            el(Rect, {
                                fill: Fills.image('./cat.jpg', { fit: 'fill' }),
                                width: 'fill',
                                height: 'fill',
                                effects: Effects.threshold({ level: 0.4, smoothness: 0.02 }).bitCrush(crush),
                            }),
                        ],
                    }),
                    el(Text, { text: 'threshold → crush', fontFamily: 'Inter', fontSize: 22, fill: '#9aa4bf' }),
                ] }),
            ],
        }),
    );
}, [
    holdTail(0),
]);
