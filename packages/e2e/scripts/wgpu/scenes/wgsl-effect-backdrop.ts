import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../../../src/doc';
import { holdTail } from '../../../src/scenes/_lib';

/**
 * {@link Effects.shader} in backdrop mode: a custom WGSL shader resamples its
 * input (the canvas content beneath the node) with a horizontal ripple whose
 * amplitude grows, distorting the checkerboard seen through the lens. The
 * ripple reads up to 18 px past the lens, which `reach` brings into its input.
 */
const LENS_WIDTH = 300;
const LENS_HEIGHT = 220;

const RIPPLE_SHADER = `
struct Params { resolution: vec2f, amount: f32 }

fn effect(in: EffectIn) -> vec4f {
    let uv = in.px / u.resolution;
    let wave = sin(uv.y * 30.0) * u.amount;
    return sample_src_px(in.px + vec2f(wave, 0.0));
}
`;

const lens = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { flow: 'grid', width: 'fill', height: 'fill', columns: 6, gap: 2, padding: 20, children: [
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#6990dd' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#e8617c' }),
            el(Rect, { width: 'fill', height: 'fill', fill: '#f2c94c' }),
        ] }),
    );
    stage.add(
        el(Rect, {
            ref: lens,
            width: LENS_WIDTH,
            height: LENS_HEIGHT,
            cornerRadius: 20,
            stroke: { weight: 4, fill: '#f4f6ff' },
            effects: Effects.shader({ source: RIPPLE_SHADER, mode: 'backdrop', reach: 24, uniforms: [
                { name: 'resolution', value: [LENS_WIDTH, LENS_HEIGHT] },
                { name: 'amount', value: 0 },
            ] }),
        }),
    );
}, [
    () => lens().to({ data: {
            effects: Effects.shader({ source: RIPPLE_SHADER, mode: 'backdrop', reach: 24, uniforms: [
                { name: 'resolution', value: [LENS_WIDTH, LENS_HEIGHT] },
                { name: 'amount', value: 18 },
            ] }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
