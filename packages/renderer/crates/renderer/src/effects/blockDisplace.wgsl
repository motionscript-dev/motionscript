// blockDisplace — glitch bands.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn hash(band: f32, salt: f32) -> f32 {
    return fract(sin(band * 78.233 + salt + param_seed() * 13.7) * 43758.5453);
}

fn effect(p: vec2f) -> vec4f {
    // The engine centres the bands on the node (geom.centerX/Y), not the box centre offset.
    let d = p - box_center();
    let axis = param_axis();
    let across = select(d.x, d.y, axis.x >= axis.y);
    let band = floor(across / max(param_size() * u.scale, 1.0));
    let moves = step(1.0 - clamp(param_density(), 0.0, 1.0), hash(band, 0.0));
    let shift = (hash(band, 37.0) * 2.0 - 1.0) * param_amount() * u.scale * moves;
    return src(p - axis * shift);
}
