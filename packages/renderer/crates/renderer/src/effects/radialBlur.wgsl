// radialBlur — zoom / spin smear.
// The engine bakes the tap count into the source; here it is a param, looped
// with a capped bound.
// style: 0 zoom, 1 spin; samples: 2-32.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let centre = box_center() + (param_center() - 0.5) * box_size();
    let amount = param_amount();
    let n = clamp(u32(param_samples()), 2u, 32u);
    let offset = p - centre;
    var acc = vec4f(0.0);
    for (var i = 0u; i < 32u; i++) {
        if (i >= n) { break; }
        let t = f32(i) / f32(n - 1u) - 0.5;
        var sample_pos: vec2f;
        if (param_style() > 0.5) {
            let angle = t * amount * 1.5707963;
            let ca = cos(angle);
            let sa = sin(angle);
            sample_pos = centre + vec2f(offset.x * ca - offset.y * sa, offset.x * sa + offset.y * ca);
        } else {
            sample_pos = centre + offset * (1.0 + t * amount);
        }
        acc += src(sample_pos);
    }
    return acc / f32(n);
}
