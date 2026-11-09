// grain — signed sin-fract hash noise per grain
// cell, cells counted from the node's top-left.
// The seed advances by floor(time · 1000), as the engine's.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn hash(cell: vec2f, seed: f32) -> f32 {
    return fract(sin(dot(cell, vec2f(127.1, 311.7)) + seed * 13.7) * 43758.5453);
}

fn effect(p: vec2f) -> vec4f {
    let c = src(p);
    if (c.a <= 0.0) { return c; }
    let cell = floor((p - box_origin()) / max(param_size() * u.scale, 1.0));
    let seed = param_seed() + select(0.0, floor(u.time * 1000.0), param_animated() > 0.5);
    let n = hash(cell, seed) - 0.5;
    var noise = vec3f(n);
    if (param_colored() > 0.5) {
        noise = vec3f(n, hash(cell + vec2f(37.0, 17.0), seed) - 0.5, hash(cell + vec2f(11.0, 91.0), seed) - 0.5);
    }
    let base = c.rgb / c.a;
    let grained = clamp(base + noise * param_amount(), vec3f(0.0), vec3f(1.0));
    return vec4f(grained * c.a, c.a);
}
