// scanlines — dark bands with a half-pixel
// smoothstep ramp, measured from the node centre.
// direction: the band axis (cos, sin).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let c = src(p);
    let spacing = param_spacing() * u.scale;
    if (c.a <= 0.0 || spacing < 1.0) { return c; }
    let d = p - box_center();
    let across = -d.x * param_direction().y + d.y * param_direction().x;
    let period = max(spacing, 1.0);
    let x = across + param_offset() * u.scale;
    let phase = (x - period * floor(x / period)) / period;
    let reach = clamp(param_thickness(), 0.0, 1.0) * 0.5;
    let aa = 0.5 / period;
    let band = smoothstep(0.5 - reach - aa, 0.5 - reach + aa, phase)
             - smoothstep(0.5 + reach - aa, 0.5 + reach + aa, phase);
    let lit = 1.0 - band * clamp(param_darkness(), 0.0, 1.0);
    return vec4f(c.rgb * lit, c.a);
}
