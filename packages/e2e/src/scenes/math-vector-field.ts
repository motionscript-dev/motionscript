import { Axes2d, StreamLines, VectorField } from '@motionscript/math';
import { createRef, easeInOut, el, linear, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * Manim's ArrowVectorField and StreamLines: a field of arrows coloured by its
 * strength, turning into another field, with the lines that follow it flowing
 * underneath.
 */
const field = createRef<VectorField>();
const flow = createRef<StreamLines>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Axes2d, {
            width: 860,
            height: 480,
            padding: 24,
            xRange: [-6, 6],
            yRange: [-3.2, 3.2],
            labels: false,
            ticks: false,
            stroke: [],
            children: [
                el(StreamLines, {
                    ref: flow,
                    expression: '(sin(y), cos(x))',
                    spacing: 0.8,
                    length: 4,
                    window: 0.35,
                    stroke: { weight: 2, fill: '#334155', align: 'center', cap: 'round', join: 'round' },
                }),
                el(VectorField, {
                    ref: field,
                    expression: '(sin(y), cos(x))',
                    spacing: 0.8,
                    arrowScale: 0.6,
                    strengthFills: ['#38bdf8', '#a3e635', '#facc15', '#f87171'],
                }),
            ],
        }),
    );
}, [
    () => flow().flowTo({ data: { phase: 1 }, duration: 1.6, easing: linear() }),
    () => field().morphTo({ data: { expression: '(-y, x)' }, duration: 1.0, easing: easeInOut('quad') }),
    holdTail(0.4),
]);
