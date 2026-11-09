// rgbShift — per-channel offset.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn tap(p: vec2f) -> vec4f {
    let c = src(p);
    if (c.a > 0.0) {
        return vec4f(c.rgb / c.a, c.a);
    }
    return vec4f(0.0);
}

fn effect(p: vec2f) -> vec4f {
    let r = tap(p - param_red() * u.scale);
    let g = tap(p - param_green() * u.scale);
    let b = tap(p - param_blue() * u.scale);
    let a = max(r.a, max(g.a, b.a));
    if (a <= 0.0) {
        return vec4f(0.0);
    }
    return vec4f(vec3f(r.r, g.g, b.b) * a, a);
}
