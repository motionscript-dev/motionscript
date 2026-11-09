import { Rect, Fills } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * A drop shadow's `fill` takes the whole fill vocabulary too, so a card can cast
 * a shadow carrying the picture above it rather than a flat smudge.
 *
 * The shadow is thrown well clear of the card and the blur kept low, so what is
 * under test is visible rather than hidden behind the thing casting it. The
 * silhouette is painted inside the shadow's own blurred, alpha'd layer, which is
 * why each fill has to do its offscreen work before that layer opens — see
 * `FillHandler.openPass`.
 */
const SWIRL = `
fn fill(in: FillIn) -> vec4f {
    let p = vec2f((in.uv.x - 0.5) * in.size.x / in.size.y, in.uv.y - 0.5);
    let a = 0.5 + 0.5 * sin(length(p) * 60.0);
    let c = mix(vec3f(0.41, 0.56, 0.87), vec3f(0.91, 0.38, 0.49), a);
    return vec4f(c * a, a);
}`;

const card = (fill: unknown) => el(Rect, {
    width: 190,
    height: 190,
    cornerRadius: 18,
    fill: '#f4f6ff',
    shadow: { blur: 12, offset: { x: 0, y: -46 }, fill: fill as never },
});

export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'horizontal', gap: 28, children: [
            card(Fills.image('cat.jpg', { fit: 'fill' })),
            card(Fills.shader(SWIRL)),
            card(Fills.stripe({ color: '#6990dd', gap: 34, strokeWidth: 22, angle: 45 })),
        ] }),
    );
}, [holdTail(1)]);
