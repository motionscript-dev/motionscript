// directionalBlur — a 1-D gaussian (sigma radius / 2) along `angle`. The renderer's blur (the packer's `blur`) does the work.
// axis: the blur direction (cos, sin).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

// The renderer spaces a long 1-D blur's taps `stride` px apart (32 a side at
// most); a box of `stride` px along the axis first keeps fine detail from
// aliasing between them, adding a negligible stride²/12 to the variance.
fn prefilter(p: vec2f) -> vec4f {
    let stride = i32(min(max(ceil(3.0 * param_sigma() * u.scale / 32.0), 1.0), 16.0));
    let axis = param_axis();
    var sum = vec4f(0.0);
    for (var k = 0; k < stride; k++) {
        sum += src(p + axis * (f32(k) - f32(stride - 1) * 0.5));
    }
    return sum / f32(stride);
}

fn effect(p: vec2f) -> vec4f {
    return blurred(p);
}
