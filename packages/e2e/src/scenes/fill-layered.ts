import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** A node's `fill` accepts an array: solid base + gradient wash + noise grain, painted bottom-to-top. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: [
                    ...Fills.color('#23283a'),
                    ...Fills.linearGradient(['#6990dd', 'transparent'], { opacity: 0 }),
                    ...Fills.noise({ density: 0.5, opacity: 0.15 }),
                ],
            }),
        ] }),
    );
}, [
    () => rect().to({ data: { fill: [...Fills.color('#23283a'), ...Fills.linearGradient(['#6990dd', 'transparent'], { opacity: 0.8 }), ...Fills.noise({ density: 0.5, opacity: 0.15 })] }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
