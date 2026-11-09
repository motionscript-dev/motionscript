// streak — bloom with a 1-D blur
// along `angle` (sigma length / 2): a threshold
// colour matrix, blurred (the packer's `blur`), scaled by an intensity matrix
// and screened onto the content.
// scale, bias: the threshold ramp; axis: the blur direction (cos, sin).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

// out = clamp(in · scale + bias) on straight colour, alpha kept.
fn threshold(c: vec4f) -> vec4f {
    let rgb = clamp(unpremul(c) * param_scale() + param_bias(), vec3f(0.0), vec3f(1.0));
    return premul(rgb, c.a);
}

// The renderer spaces a long 1-D blur's taps `stride` px apart (32 a side at
// most); a box of `stride` px along the axis first keeps fine detail from
// aliasing between them, adding a negligible stride²/12 to the variance.
fn prefilter(p: vec2f) -> vec4f {
    let stride = i32(min(max(ceil(3.0 * param_sigma() * u.scale / 32.0), 1.0), 16.0));
    let axis = param_axis();
    var sum = vec4f(0.0);
    for (var k = 0; k < stride; k++) {
        sum += threshold(src(p + axis * (f32(k) - f32(stride - 1) * 0.5)));
    }
    return sum / f32(stride);
}

fn effect(p: vec2f) -> vec4f {
    var glow = blurred(p);
    let i = param_intensity();
    if (i != 1.0) {
        glow = premul(clamp(unpremul(glow) * i, vec3f(0.0), vec3f(1.0)), glow.a);
    }
    return blend_mode(2u, glow, src(p));
}
