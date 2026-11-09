// twirl — vortex.
// angle: radians.

const TILE_CLAMP: bool = true;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let centre = box_center() + (param_center() - 0.5) * box_size();
    let h = max(box_half(), vec2f(1.0));
    let q = (p - centre) / h;
    let r = length(q);
    let radius = param_radius();
    if (r >= radius) {
        return src(p);
    }
    let falloff = 1.0 - r / max(radius, 0.0001);
    let a = param_angle() * falloff * falloff;
    let c = cos(a);
    let s = sin(a);
    let rotated = vec2f(q.x * c - q.y * s, q.x * s + q.y * c);
    return src(centre + rotated * h);
}
