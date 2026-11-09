import { Ellipse, type Node2D } from '@motionscript/sdk';
import { RectV2 } from '@/components/component-syntax';
import { cmd, createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** Stroke, shadow, corners, overlay, clip, a flowed row and a draw-on, with every rect written as `component2d`. Its frames should match `component2d-styled-class` pixel for pixel. */
const card = createRef<Node2D>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(RectV2, { width: 'fill', height: 'fill', flow: 'freeform', children: [
            el(RectV2, {
                ref: card,
                width: 600,
                height: 300,
                fill: 'card',
                overlay: 'white/5',
                stroke: { weight: 8, fill: 'primary' },
                shadow: { blur: 24, fill: 'black/60' },
                cornerRadius: 36,
                cornerStyle: 'angled',
                flow: 'horizontal',
                gap: 24,
                padding: 32,
                align: 'center',
                clip: true,
                end: 0.15,
                children: [
                    el(RectV2, { width: 120, height: 120, cornerRadius: 20, fill: 'primary' }),
                    el(RectV2, {
                        width: 120,
                        height: 160,
                        cornerRadius: { topLeft: 40, bottomRight: 40 },
                        fill: 'accent',
                    }),
                    el(Ellipse, { width: 260, height: 260, fill: 'white/20' }),
                ],
            }),
        ] }),
    );
}, [
    () => cmd(card, 'progressTo', { end: 1 }, 1.2, easeInOut('quad')),
    holdTail(1.2),
]);
