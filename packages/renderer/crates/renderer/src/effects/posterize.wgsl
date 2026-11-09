// posterize — each straight
// channel collapsed to `levels` evenly spaced tones.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn effect(p: vec2f) -> vec4f {
    // The engine's snapshot is 8-bit: quantise so band edges fall alike.
    let c = round(src(p) * 255.0) / 255.0;
    if (c.a <= 0.0) {
        return vec4f(0.0);
    }
    let l = max(floor(param_levels() + 0.5), 2.0);
    let q = clamp(min(floor(c.rgb / c.a * l), vec3f(l - 1.0)) / (l - 1.0), vec3f(0.0), vec3f(1.0));
    return premul(q, c.a);
}
