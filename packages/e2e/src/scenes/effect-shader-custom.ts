import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Effects.shader} on the node's own layer: a custom WGSL shader
 * generates a coloured glow from position and an `amount` uniform,
 * screen-blended onto the layer as it ramps from invisible to fully bright.
 * The glow sits on the card's bottom-right corner and spills past the card,
 * which `reach` makes room for.
 */
const CARD_WIDTH = 360;
const CARD_HEIGHT = 240;

const GLOW_SHADER = `
struct Params { amount: f32 }

fn effect(in: EffectIn) -> vec4f {
    // Centred on the card's bottom-right corner.
    let uv = in.uv - 1.0;
    let glow = (1.0 - smoothstep(0.0, 0.6, length(uv))) * u.amount;
    return vec4f(glow, glow * 0.6, glow * 0.9, glow);
}
`;

const glow = (amount: number) => Effects.shader({ source: GLOW_SHADER, blendMode: 'screen', reach: 240, uniforms: { amount } });

const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                cornerRadius: 20,
                fill: 'card',
                effects: glow(0),
            }),
        ] }),
    );
}, [
    () => card().to({ data: { effects: glow(1.2) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
