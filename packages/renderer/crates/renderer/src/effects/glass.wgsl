// glass — backdrop lens: the
// backdrop seen through a slab whose edge is a convex squircle bevel over the
// node's inside distance field, refracted by Snell's law, optionally split
// into a 7-tap spectrum and frosted, with a rim of light.
// light: unit vector toward the light (y down); rim: rim gain; shade_near: shade
// facing the light; shade_far: glow facing away; shade_reach: shading reach
// (share of the bevel); frost: blur sigma (logical px).

const TILE_CLAMP: bool = true;
const FILTER_NEAREST: bool = false;

const BASE: f32 = 0.5;
const ETA: f32 = 1.0 / 1.5;
const RIM_WIDTH: f32 = 1.4;
const LOBE: f32 = 1.2;
const FAR_SIDE: f32 = 0.75;

// The engine's frost is a separate pre-blurred copy of the backdrop, sampled
// clamped like the backdrop itself.
fn backdrop(p: vec2f) -> vec4f {
    if (param_frost() * u.scale > 0.25) {
        return sample_region(blur_tex, u.blur_rect, u.blur_page, (p - u.src_origin) / u.blur_scale, true, false);
    }
    return src(p);
}

fn pow0(x: f32, e: f32) -> f32 {
    return select(0.0, pow(x, e), x > 0.0);
}

fn effect(p: vec2f) -> vec4f {
    let deepest = max_distance();
    let bevel = min(max(0.0, param_depth()) * u.scale, deepest);
    if (!(bevel > 0.0)) {
        // No field or no depth: the engine paints no lens.
        return src(p);
    }
    let d = field(p);
    let g = vec2f(field(p + vec2f(1.0, 0.0)) - field(p - vec2f(1.0, 0.0)),
                  field(p + vec2f(0.0, 1.0)) - field(p - vec2f(0.0, 1.0)));
    let gl = length(g);
    // Distance grows inward, so the outward normal is its negated gradient.
    let n = select(vec2f(0.0), -g / gl, gl > 1e-4);

    // Squircle bevel: height h and its slope over the bevel.
    let x = clamp(d / bevel, 0.001, 1.0);
    let y = 1.0 - x;
    let y4 = y * y * y * y;
    let h = pow(1.0 - y4, 0.25);
    let slope = y * y * y * pow(max(1.0 - y4, 1e-6), -0.75);

    // Refract a straight-down ray through the surface normal (n·slope, 1).
    let cosi = inverseSqrt(1.0 + slope * slope);
    let k = 1.0 - ETA * ETA * (1.0 - cosi * cosi);
    let a = ETA * cosi - sqrt(max(k, 0.0));
    let lateral = a * slope * cosi;
    let down = a * cosi - ETA;
    let pull = n * (lateral / -down) * (bevel * h + BASE * bevel) * param_refraction();

    let spread = param_spread();
    var glass: vec4f;
    if (spread > 0.0) {
        // Red bends least and blue most, weighted per channel into a spectrum.
        var sum = vec3f(0.0);
        var weight = vec3f(0.0);
        var alpha = 0.0;
        for (var i = 0; i < 7; i++) {
            let t = f32(i) / 6.0;
            let s = backdrop(p + pull * (1.0 + spread * (t * 2.0 - 1.0)));
            let q = (vec3f(t) - vec3f(0.0, 0.5, 1.0)) / 0.3;
            let w = exp(-(q * q));
            sum += s.rgb * w;
            weight += w;
            alpha += s.a;
        }
        glass = vec4f(sum / weight, alpha / 7.0);
        glass = vec4f(min(glass.rgb, vec3f(glass.a)), glass.a);
    } else {
        glass = backdrop(p + pull);
    }

    let facing = dot(n, param_light());
    let near = pow0(facing, LOBE);
    let far = FAR_SIDE * pow0(-facing, LOBE);

    // Light projected through the bevel: a shade darker on the side facing
    // it, landing on the opposite side, fading out across the bevel.
    let across = 1.0 - smoothstep(0.0, param_shade_reach(), x);
    var rgb = glass.rgb * (1.0 - param_shade_near() * near * across);
    rgb += (vec3f(glass.a) - rgb) * (param_shade_far() * far / FAR_SIDE * across);
    glass = vec4f(rgb, glass.a);

    // A thin rim on the outline, white source-over.
    let spec = clamp(param_rim() * (near + far) * (1.0 - smoothstep(0.0, RIM_WIDTH * u.scale, d)), 0.0, 1.0);
    return vec4f(spec) + glass * (1.0 - spec);
}
