// scatter — each pixel (node-local) hashes to
// a jitter in ±1 and reads the source that far away.
// offset: the largest displacement per axis.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn hash(p: vec2f, salt: f32) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7)) + salt) * 43758.5453);
}

fn effect(p: vec2f) -> vec4f {
    let cell = floor(p - box_origin());
    let jitter = vec2f(hash(cell, 0.0), hash(cell, 37.13)) * 2.0 - 1.0;
    return src(p + jitter * param_offset() * u.scale);
}
