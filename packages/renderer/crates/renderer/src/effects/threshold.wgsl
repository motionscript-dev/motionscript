// threshold — luminance cut
// to black and white at `level`, a smoothstep `smoothness` wide.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn effect(p: vec2f) -> vec4f {
    // The engine's snapshot is 8-bit: quantise so the cut falls alike.
    let c = round(src(p) * 255.0) / 255.0;
    if (c.a <= 0.0) {
        return c;
    }
    let l = dot(c.rgb / c.a, vec3f(0.2126, 0.7152, 0.0722));
    let level = param_level();
    let half_width = max(param_smoothness(), 0.0) * 0.5;
    var v: f32;
    if (half_width <= 0.0) {
        v = step(level, l);
    } else {
        v = smoothstep(level - half_width, level + half_width, l);
    }
    return vec4f(vec3f(v) * c.a, c.a);
}
