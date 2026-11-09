// lut — a 3D LUT baked into an
// N²×N strip (the aux texture, as the engine's resources() bakes it): red and
// green interpolate in the bilinear tap, blue between two slices.

const TILE_CLAMP: bool = true;
const FILTER_NEAREST: bool = false;

fn lookup(c: vec3f) -> vec3f {
    let n = param_size();
    let q = clamp(c, vec3f(0.0), vec3f(1.0)) * (n - 1.0);
    let b0 = floor(q.b);
    let b1 = min(b0 + 1.0, n - 1.0);
    let uv = q.rg + 0.5;
    let lo = aux_texel(vec2f(uv.x + b0 * n, uv.y), false).rgb;
    let hi = aux_texel(vec2f(uv.x + b1 * n, uv.y), false).rgb;
    return mix(lo, hi, q.b - b0);
}

fn effect(p: vec2f) -> vec4f {
    let c = round(src(p) * 255.0) / 255.0;
    if (c.a <= 0.0) {
        return c;
    }
    let rgb = c.rgb / c.a;
    return vec4f(mix(rgb, lookup(rgb), clamp(param_amount(), 0.0, 1.0)) * c.a, c.a);
}
