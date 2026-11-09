import { Axes2d, DropLines, FunctionPlot } from '@motionscript/math';
import { Text } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's SinAndCosFunctionPlot: axes without tips, a sine and a cosine with
 * their names beside them, and a guide dropped from the cosine at x = 2π.
 */
const sine = createRef<FunctionPlot>();
const cosine = createRef<FunctionPlot>();
const guide = createRef<DropLines>();
const TAU = Math.PI * 2;
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Axes2d, {
            width: 860,
            height: 380,
            padding: 30,
            fontFamily: 'Inter',
            xRange: [-10, 10.3],
            yRange: [-1.5, 1.5],
            xStep: 2,
            yStep: 1,
            stroke: { weight: 2, fill: '#9ca3af', align: 'center' },
            children: [
                el(FunctionPlot, {
                    ref: sine,
                    expression: 'sin(x)',
                    end: 0,
                    stroke: { weight: 3, fill: 'primary', align: 'center', join: 'round' },
                }),
                el(FunctionPlot, {
                    ref: cosine,
                    expression: 'cos(x)',
                    end: 0,
                    stroke: { weight: 3, fill: 'accent', align: 'center', join: 'round' },
                }),
                el(DropLines, {
                    ref: guide,
                    on: 'functionPlot1',
                    x: TAU,
                    axis: 'x',
                    end: 0,
                    stroke: { weight: 3, fill: '#facc15', align: 'center' },
                }),
                el(Text, { x: -9.2, y: 1.15, text: 'sin(x)', fontSize: 24, fontFamily: 'Inter', fill: 'primary' }),
                el(Text, { x: -9.2, y: -1.15, text: 'cos(x)', fontSize: 24, fontFamily: 'Inter', fill: 'accent' }),
                el(Text, { x: TAU + 1.3, y: 0.5, text: 'x = 2π', fontSize: 22, fontFamily: 'Inter', fill: 'white' }),
            ],
        }),
    );
}, [
    [
        () => sine().progressTo({ data: { end: 1 }, duration: 1, easing: easeInOut('quad') }),
        () => cosine().progressTo({ data: { end: 1 }, duration: 1, easing: easeInOut('quad') }),
    ],
    () => guide().progressTo({ data: { end: 1 }, duration: 0.4, easing: easeInOut('quad') }),
    holdTail(0.6),
]);
