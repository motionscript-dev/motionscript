import { Rect, Text, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Effects.glow}: a thresholded pass spread past the node's own box and
 * recoloured through a ramp, as `intensity` and `phase` ramp up.
 *
 * The radius is deliberately large. A glow's spread is built by the renderer's
 * separable Gaussian (see `RenderInputRequest.blurredSource`), and the failure
 * this scene exists to catch is that regressing to a per-fragment tap disc,
 * which bands visibly at exactly this radius and not at a small one.
 */
const card = createRef<Rect>();
const RAMP = { colors: ['#ffffff', '#ff9a2e', '#7b2ff7'], stops: [0, 0.5, 1] };

export default scene((stage) => {
    stage.set({ fill: '#07070c' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 360,
                height: 240,
                cornerRadius: 20,
                fill: '#07070c',
                flow: 'freeform',
                align: { x: 0, y: 0 },
                effects: Effects.glow({ threshold: 0.4, radius: 60, intensity: 0, tint: 'ramp', ...RAMP }),
                children: [
                    el(Text, { text: 'GLOW', fontFamily: 'Inter', fontWeight: 800, fontSize: 56, fill: '#f4f6ff' }),
                ],
            }),
        ] }),
    );
}, [
    () =>
        card().to({ data: {
                effects: Effects.glow({
                    threshold: 0.4,
                    radius: 60,
                    intensity: 2.2,
                    tint: 'ramp',
                    ...RAMP,
                    cycles: 2,
                    // Animated phase is the point of the field: colour travels
                    // through the glow rather than the glow merely brightening.
                    phase: 180,
                }),
            }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
