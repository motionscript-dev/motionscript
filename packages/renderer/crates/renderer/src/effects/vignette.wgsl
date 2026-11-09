// vignette — lens edge falloff.
// Positions are normalised by the box half-extent, so r is 1 at each edge's
// middle whatever the aspect; the tint mixes toward the colour (not a
// multiply), so non-black vignettes work too.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let c = src(p);
    if (c.a <= 0.0) {
        return c;
    }
    let color = param_color();
    let q = (p - box_center()) / max(box_half(), vec2f(1.0));
    let r = length(q);
    let inner = param_radius();
    let outer = param_radius() + max(param_softness(), 0.001);
    let falloff = smoothstep(inner, outer, r) * param_amount() * color.a;
    let base = unpremul(c);
    let tinted = mix(base, color.rgb, clamp(falloff, 0.0, 1.0));
    return premul(tinted, c.a);
}
