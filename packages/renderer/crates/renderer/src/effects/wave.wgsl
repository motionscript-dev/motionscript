// wave — sine displacement.
// phase: radians; direction: (cos, sin); shape: 0 linear, 1 radial.

const TILE_CLAMP: bool = true;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let centre = box_center() + (param_center() - 0.5) * box_size();
    let d = p - centre;
    let t = select(dot(d, vec2f(param_direction().x, param_direction().y)), length(d), param_shape() > 0.5);
    let k = 6.28318530718 / max(param_wavelength() * u.scale, 1.0);
    let w = sin(t * k + param_phase());
    return src(p + param_amplitude() * u.scale * w);
}
