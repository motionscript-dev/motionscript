import { Rect, Effects } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A backdrop shader whose uniforms are supplied in an order matching no
 * declaration — which only renders correctly when they bind **by name**.
 *
 * Concatenating the authored values in array order would write `tint`'s three
 * floats into `resolution` and `amount`'s slots: a ripple amplitude of 0.05
 * against a resolution of `[0.3, 16]`. Nothing would announce it — the frame
 * simply comes out wrong.
 *
 * `tint` is a `vec3f` on purpose. WGSL's uniform layout puts it at byte 0 with
 * 16-byte alignment and packs the `f32` after it into its fourth slot, then
 * aligns the `vec2f` to byte 16: exactly the shape a hand-rolled marshaller
 * gets wrong.
 */
const LENS_WIDTH = 320;
const LENS_HEIGHT = 240;

const TINTED_RIPPLE = `
struct Params {
    tint: vec3f,
    amount: f32,
    resolution: vec2f,
}

fn effect(in: EffectIn) -> vec4f {
    let uv = in.px / u.resolution;
    let wave = sin(uv.y * 26.0) * u.amount;
    let src = sample_src_px(in.px + vec2f(wave, 0.0));
    return vec4f(mix(src.rgb, u.tint, 0.4), src.a);
}
`;

/** Deliberately not declaration order — the whole point of the scene. */
const uniformsAt = (amount: number) => [
    { name: 'amount', value: amount },
    { name: 'resolution', value: [LENS_WIDTH, LENS_HEIGHT] },
    { name: 'tint', value: [0.05, 0.55, 0.35] },
];

// `reach` brings the 14 px the ripple reads past the lens into its input.
const lens = createRef<Rect>();

export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { flow: 'grid', width: 'fill', height: 'fill', columns: 6, gap: 2, padding: 20, children: [
            Array.from({ length: 12 }, (_, i) => el(Rect, { width: 'fill', height: 'fill', fill: ['#6990dd', '#e8617c', '#f2c94c'][i % 3] })),
        ] }),
    );
    stage.add(
        el(Rect, {
            ref: lens,
            width: LENS_WIDTH,
            height: LENS_HEIGHT,
            cornerRadius: 20,
            stroke: { weight: 4, fill: '#f4f6ff' },
            effects: Effects.shader({ source: TINTED_RIPPLE, mode: 'backdrop', reach: 24, uniforms: uniformsAt(0) }),
        }),
    );
}, [
    () => lens().to({ data: { effects: Effects.shader({ source: TINTED_RIPPLE, mode: 'backdrop', reach: 24, uniforms: uniformsAt(14) }) }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
