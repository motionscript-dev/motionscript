// progressiveBlur — blur whose radius ramps across the box. The tap count is a param (loop
// capped at 32).
// shape: 0 linear, 1 radial; samples: 2-32.

const TILE_CLAMP: bool = true;
const FILTER_NEAREST: bool = false;

fn hash(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn effect(p: vec2f) -> vec4f {
    let centre = box_center() + (param_center() - 0.5) * box_size();
    let h = max(box_half(), vec2f(1.0));
    let q = (p - centre) / h;
    let t = select(dot(q, param_direction()) * 0.5 + 0.5, length(q), param_shape() > 0.5);
    let s = param_start();
    let ramp = smoothstep(s, max(param_end(), s + 0.0001), clamp(t, 0.0, 1.0));
    let radius = mix(param_start_radius(), param_radius(), ramp) * u.scale;

    var sum = src(p);
    if (radius < 0.5) {
        return sum;
    }
    let n = clamp(u32(param_samples()), 2u, 32u);
    let jitter = hash(p) * 6.28318530718;
    for (var i = 1u; i <= 32u; i++) {
        if (i > n) { break; }
        let fi = f32(i);
        let ang = fi * 2.39996323 + jitter;
        let rad = radius * sqrt(fi / f32(n));
        sum += src(p + vec2f(cos(ang), sin(ang)) * rad);
    }
    return sum / f32(n + 1u);
}
