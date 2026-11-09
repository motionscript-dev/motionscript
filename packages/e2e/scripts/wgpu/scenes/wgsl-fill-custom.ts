import { Rect, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../../../src/doc';
import { holdTail } from '../../../src/scenes/_lib';

/**
 * A ring whose radius is driven by one tweened uniform.
 *
 * Kept deliberately narrow so it can only fail for one reason. It reads the
 * box's aspect from `in.size` and its own `amount`, and nothing else: no
 * `in.time` (which would confound a clock regression with a marshalling one), no
 * `in.scale` (which folds in pixel ratio and camera zoom, so it renders
 * differently at export scale), no textures, no `blend`, no `opacity` tween, no
 * stroke and no shadow. Geometry and colour are constants, so the only thing that
 * differs across the first/mid/last frames is the uniform.
 *
 * The aspect earns its place by being separately diagnosable: the card is 3:2, so
 * a wrong box size shows up as an ellipse in *all three* frames, which is a
 * different signature from a ring that fails to grow.
 */
const RING = `
struct Params { amount: f32 }

fn fill(in: FillIn) -> vec4f {
    // Square up the horizontal axis, so the ring is a circle on a 3:2 card.
    let aspect = in.size.x / in.size.y;
    let p = vec2f((in.uv.x - 0.5) * aspect, in.uv.y - 0.5);
    let r = 0.06 + u.amount * 0.30;
    let d = abs(length(p) - r);
    let a = 1.0 - smoothstep(0.012, 0.030, d);
    // Premultiplied, and without folding the layer's opacity in.
    let c = vec3f(0.41, 0.56, 0.87);
    return vec4f(c * a, a);
}`;

/** {@link Fills.shader}: a custom WGSL fill with one tweened uniform. */
const card = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: card,
                width: 360,
                height: 240,
                cornerRadius: 20,
                clip: true,
                fill: ['card', Fills.shader(RING, { uniforms: { amount: 0 } })],
            }),
        ] }),
    );
}, [
    () => card().to({ data: { fill: ['card', Fills.shader(RING, { uniforms: { amount: 1 } })] }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
