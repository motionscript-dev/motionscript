// bitCrush — straight colour
// quantised to 2^bits steps per channel, or snapped to the nearest palette
// entry (squared distance, gamma-encoded), mixed by `amount`.
// count: palette entries (0 = quantise to `bits`).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn effect(p: vec2f) -> vec4f {
    // The engine's snapshot is 8-bit: quantise so steps fall alike.
    let c = round(src(p) * 255.0) / 255.0;
    if (c.a <= 0.0) {
        return c;
    }
    let base = clamp(c.rgb / c.a, vec3f(0.0), vec3f(1.0));
    let n = min(u32(param_count()), 16u);
    var crushed: vec3f;
    if (n == 0u) {
        let steps = max(exp2(clamp(param_bits(), 1.0, 8.0)) - 1.0, 1.0);
        crushed = floor(base * steps + 0.5) / steps;
    } else {
        crushed = param_palette(0u);
        var best = dot(base - crushed, base - crushed);
        for (var i = 1u; i < n; i++) {
            let e = param_palette(i);
            let d = dot(base - e, base - e);
            if (d < best) {
                best = d;
                crushed = e;
            }
        }
    }
    return vec4f(mix(base, crushed, clamp(param_amount(), 0.0, 1.0)) * c.a, c.a);
}
