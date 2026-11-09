import { Rect, Fills } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A stroke takes the *whole* fill vocabulary, not just colours and gradients.
 *
 * The band is painted by the same renderer a node's own fill goes through — the
 * full lifecycle, so a fill that decodes an asset, compiles a shader or renders
 * offscreen behaves here exactly as it does in a `fill`. Four of the kinds at
 * once, because what each one needs from that lifecycle differs: an image wants a
 * decoded texture, a video a frame at the node's own elapsed time, a shader a
 * compiled program, a pattern nothing but bounds.
 */
const SWIRL = `
fn fill(in: FillIn) -> vec4f {
    let p = vec2f((in.uv.x - 0.5) * in.size.x / in.size.y, in.uv.y - 0.5);
    let a = 0.5 + 0.5 * sin(length(p) * 60.0);
    let c = mix(vec3f(0.41, 0.56, 0.87), vec3f(0.91, 0.38, 0.49), a);
    return vec4f(c * a, a);
}`;

const band = (fill: unknown) => el(Rect, {
    width: 190,
    height: 190,
    cornerRadius: 18,
    fill: 'transparent',
    stroke: { weight: 28, fill: fill as never },
});

export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'horizontal', gap: 28, children: [
            band(Fills.image('cat.jpg', { fit: 'fill' })),
            band(Fills.video('video.mp4', { fit: 'fill' })),
            band(Fills.shader(SWIRL)),
            band(Fills.stripe({ color: '#6990dd', gap: 10, strokeWidth: 6, angle: 45 })),
        ] }),
    );
}, [holdTail(1)]);
