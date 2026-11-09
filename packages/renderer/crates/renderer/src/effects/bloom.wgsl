// bloom — a threshold colour
// matrix, blurred (the packer's `blur`), scaled by an intensity matrix and
// screened onto the content.
// scale, bias: the threshold ramp (in - t) / (1 - t).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

// out = clamp(in · scale + bias) on straight colour, alpha kept.
fn prefilter(p: vec2f) -> vec4f {
    let c = src(p);
    let rgb = clamp(unpremul(c) * param_scale() + param_bias(), vec3f(0.0), vec3f(1.0));
    return premul(rgb, c.a);
}

fn effect(p: vec2f) -> vec4f {
    var glow = blurred(p);
    let i = param_intensity();
    if (i != 1.0) {
        glow = premul(clamp(unpremul(glow) * i, vec3f(0.0), vec3f(1.0)), glow.a);
    }
    return blend_mode(2u, glow, src(p));
}
