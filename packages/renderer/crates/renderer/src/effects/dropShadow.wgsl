// dropShadow — spread (ring-max dilation),
// offset, then a gaussian-weighted disc average on rings of 12 taps; the
// content goes over its shadow.
// offset is y-down.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

const TAPS: i32 = 12;
const STEP: f32 = 0.5235988;

fn silhouette(q: vec2f, spread: f32) -> f32 {
    var a = src(q).a;
    if (spread > 0.0) {
        for (var i = 0; i < TAPS; i++) {
            let t = f32(i) * STEP;
            a = max(a, src(q + vec2f(cos(t), sin(t)) * spread).a);
        }
    }
    return a;
}

fn rings_for(sigma: f32) -> i32 {
    let wanted = sigma / 4.0;
    if (wanted <= 2.0) { return 2; }
    if (wanted <= 3.0) { return 3; }
    if (wanted <= 4.0) { return 4; }
    return 6;
}

fn effect(p: vec2f) -> vec4f {
    let s = src(p);
    let color = param_color();
    let sigma = param_sigma() * u.scale;
    let spread = param_spread() * u.scale;
    let origin = p - param_offset() * u.scale;
    var shadow_alpha: f32;
    if (sigma <= 0.0) {
        shadow_alpha = silhouette(origin, spread);
    } else {
        var sum = silhouette(origin, spread);
        var weight = 1.0;
        let rings = rings_for(sigma);
        for (var r = 1; r <= 6; r++) {
            if (r > rings) { break; }
            let radius = 3.0 * sigma * f32(r) / f32(rings);
            let w = exp(-(radius * radius) / (2.0 * sigma * sigma));
            for (var i = 0; i < TAPS; i++) {
                let t = f32(i) * STEP;
                sum += silhouette(origin + vec2f(cos(t), sin(t)) * radius, spread) * w;
                weight += w;
            }
        }
        shadow_alpha = sum / weight;
    }
    let a = clamp(shadow_alpha, 0.0, 1.0) * color.a;
    let shadow = vec4f(color.rgb * a, a);
    return s + shadow * (1.0 - s.a);
}
