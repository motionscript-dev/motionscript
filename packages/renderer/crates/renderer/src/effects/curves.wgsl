// curves — a piecewise-
// linear tone curve resampled to 33 evenly spaced values, on the straight
// channels the mask selects (alpha included).
// mask: the channels the curve applies to (rgba); curve: 33 evenly spaced outputs.

const TILE_CLAMP: bool = true;
const FILTER_NEAREST: bool = false;

const SEGMENTS: u32 = 32u;

// The engine's telescoping sum: every segment below t adds its whole rise.
fn lookup(c: vec4f) -> vec4f {
    let t = clamp(c, vec4f(0.0), vec4f(1.0)) * f32(SEGMENTS);
    var y = vec4f(param_curve(0u));
    for (var i = 0u; i < SEGMENTS; i++) {
        y += (param_curve(i + 1u) - param_curve(i)) * clamp(t - f32(i), vec4f(0.0), vec4f(1.0));
    }
    return y;
}

fn effect(p: vec2f) -> vec4f {
    let c = round(src(p) * 255.0) / 255.0;
    if (c.a <= 0.0) {
        return c;
    }
    let straight = vec4f(c.rgb / c.a, c.a);
    let curved = mix(straight, lookup(straight), param_mask());
    return vec4f(clamp(curved.rgb, vec3f(0.0), vec3f(1.0)) * curved.a, curved.a);
}
