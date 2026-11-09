// sharpen — unsharp mask over a 3×3 tent.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let c = src(p);
    if (c.a <= 0.0) {
        return c;
    }
    let r = max(param_radius() * u.scale, 0.5);
    var sum = c * 4.0;
    sum += src(p + vec2f(r, 0.0)) * 2.0;
    sum += src(p + vec2f(-r, 0.0)) * 2.0;
    sum += src(p + vec2f(0.0, r)) * 2.0;
    sum += src(p + vec2f(0.0, -r)) * 2.0;
    sum += src(p + vec2f(r, r));
    sum += src(p + vec2f(r, -r));
    sum += src(p + vec2f(-r, r));
    sum += src(p + vec2f(-r, -r));
    let bl = sum / 16.0;
    let base = c.rgb / c.a;
    let reference = select(base, bl.rgb / bl.a, bl.a > 0.0);
    let sharpened = clamp(base + (base - reference) * param_amount(), vec3f(0.0), vec3f(1.0));
    return vec4f(sharpened * c.a, c.a);
}
