// bulge — barrel/pincushion lens.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let strength = param_strength();
    let centre = box_center() + (param_center() - 0.5) * box_size();
    let h = max(box_half(), vec2f(1.0));
    let q = (p - centre) / h;
    let r = length(q);
    let k = select(strength * 0.8, strength * 2.0, strength > 0.0);
    let scale = 1.0 + k;
    let distorted = q * (1.0 + k * r * r) / scale;
    return src(centre + distorted * h);
}
