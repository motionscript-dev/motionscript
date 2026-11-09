// glow — the prefilter thresholds (or takes
// alpha) with a colour matrix and dilates by `spread`; the renderer blurs
// that into `blurred()`; the pass tints it and blends it with the content.
// channel: 0 luminance, 1 alpha; tint: 0 none, 1 solid, 2 ramp; original: 0
// behind, 1 front, 2 hidden (core's option order). blend: blend_mode's index;
// count: ramp stops; phase: turns; mirror: 1 mirror, 0 repeat. colors: the
// ramp (solid = the first).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn prefilter(p: vec2f) -> vec4f {
    // Dilation: max over a (2r+1)² box, then the matrix runs first
    // in the engine (dilate wraps the matrix filter), so matrix per tap.
    let r = i32(round(param_spread() * u.scale));
    if (r <= 0) {
        return threshold(src(p));
    }
    var m = vec4f(0.0);
    let rr = min(r, 24);
    for (var y = -rr; y <= rr; y++) {
        for (var x = -rr; x <= rr; x++) {
            m = max(m, threshold(src(p + vec2f(f32(x), f32(y)))));
        }
    }
    return m;
}

// The engine's prefilter matrix: alpha into every channel, or a threshold
// ramp t..1 → 0..1 on colour (straight colour in, clamped, premultiplied).
fn threshold(c: vec4f) -> vec4f {
    let a = c.a;
    if (param_channel() > 0.5) {
        return premul(vec3f(a), a);
    }
    let t = clamp(param_threshold(), 0.0, 1.0);
    let s = select(1.0, 1.0 / (1.0 - t), t < 1.0);
    let rgb = clamp(unpremul(c) * s - t * s, vec3f(0.0), vec3f(1.0));
    return premul(rgb, a);
}

fn wrap(x: f32) -> f32 {
    if (param_mirror() > 0.5) {
        return abs(fract(x * 0.5) * 2.0 - 1.0);
    }
    return fract(x);
}

fn ramp_color(e: f32) -> vec3f {
    let uu = wrap(e * param_cycles() + param_phase());
    let n = u32(param_count());
    var c = param_colors(0u).rgb;
    for (var i = 1u; i < n; i++) {
        let span = max(param_stops(i) - param_stops(i - 1u), 1e-5);
        let t = clamp((uu - param_stops(i - 1u)) / span, 0.0, 1.0);
        c = mix(c, param_colors(i).rgb, t);
    }
    return c;
}

fn effect(p: vec2f) -> vec4f {
    let halo = blurred(p);
    let intensity = param_intensity();
    let tint = u32(param_tint());
    var glow: vec4f;
    if (tint == 0u) {
        glow = halo * intensity;
    } else {
        let e = clamp(dot(halo.rgb, vec3f(0.2126, 0.7152, 0.0722)) * intensity, 0.0, 1.0);
        var rgb = param_colors(0u).rgb;
        if (tint == 2u) {
            rgb = ramp_color(e);
        }
        glow = vec4f(rgb * e, e);
    }
    let original = u32(param_original());
    if (original == 2u) {
        return glow;
    }
    let content = src(p);
    let lit = blend_mode(u32(param_blend()), glow, content);
    if (original == 0u) {
        return lit;
    }
    return content + lit * (1.0 - content.a);
}
