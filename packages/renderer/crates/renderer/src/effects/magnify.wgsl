// magnify — backdrop lens.
// center: 0-1 box coords.

const TILE_CLAMP: bool = true;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let centre = box_center() + (param_center() - 0.5) * box_size();
    return src(centre + (p - centre) / max(param_scale(), 0.001));
}
