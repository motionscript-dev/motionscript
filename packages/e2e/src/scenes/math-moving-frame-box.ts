import { Rect } from '@motionscript/sdk';
import { CurlyBrace, EmphasisMark, Latex } from '@motionscript/math';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's MovingFrameBox, with BraceAnnotation's brace: the product rule, a box
 * drawn on its first term and slid to its second, and a brace under the term
 * the box is on. Box and brace name the formula's parts by their source.
 */
const box = createRef<EmphasisMark>();
const brace = createRef<CurlyBrace>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Latex, {
                latex: "\\frac{d}{dx} f(x)g(x) = f(x) \\frac{d}{dx} g(x) + g(x) \\frac{d}{dx} f(x)",
                fontSize: 38,
                fill: '#f4f6ff',
            }),
            el(EmphasisMark, { ref: box, on: 'latex0', part: "f(x) \\frac{d}{dx} g(x)", end: 0, clearance: 12 }),
            el(CurlyBrace, {
                ref: brace,
                on: 'latex0',
                part: "f(x) \\frac{d}{dx} g(x)",
                clearance: 22,
                reach: 18,
                label: '$f\\,g\'$',
                labelSize: 30,
                end: 0,
            }),
        ] }),
    );
}, [
    () => box().progressTo({ data: { end: 1 }, duration: 0.6, easing: easeInOut('quad') }),
    () => brace().progressTo({ data: { end: 1 }, duration: 0.5, easing: easeInOut('quad') }),
    [
        () => box().retargetTo({ data: { part: "g(x) \\frac{d}{dx} f(x)" }, duration: 1, easing: easeInOut('quad') }),
        () => brace().retargetTo({ data: { part: "g(x) \\frac{d}{dx} f(x)" }, duration: 1, easing: easeInOut('quad') }),
    ],
    holdTail(0.6),
]);
