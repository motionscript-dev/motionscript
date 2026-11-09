// kaleidoscope — mirrored wedge fold.
// wedge, angle: radians.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let centre = box_center() + (param_center() - 0.5) * box_size();
    let h = max(box_half(), vec2f(1.0));
    let q = (p - centre) / h;
    let wedge = param_wedge();
    let r = length(q);
    var a = atan2(q.y, q.x) - param_angle();
    a = a - wedge * floor(a / wedge); // GLSL mod
    a = abs(a - wedge * 0.5);
    a += param_angle();
    let sampled = vec2f(cos(a), sin(a)) * max(r + param_offset(), 0.0);
    let folded = src(centre + sampled * h);
    return mix(src(p), folded, param_amount());
}
