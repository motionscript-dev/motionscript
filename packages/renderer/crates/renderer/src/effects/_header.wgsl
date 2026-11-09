// Shared by every effect (prepended to each effect's file). An effect is a
// fragment program over the layer, in DEVICE pixels: `fn effect(p: vec2f) -> vec4f` gets the output pixel's device
// position and returns premultiplied RGBA. An effect may also define
// `fn prefilter(p: vec2f) -> vec4f`, run before the blur that feeds
// `blurred()` (a glow's threshold, say).
//
// An effect file declares how its input is sampled:
//   const TILE_CLAMP: bool = false;     // true = clamp to the edge, false = decal
//   const FILTER_NEAREST: bool = false; // true = nearest, false = bilinear

struct EffectU {
    // input region inside its page (texels): x, y, w, h
    src_rect: vec4f,
    // device position of the input region's top-left; page size (texels)
    src_origin: vec2f,
    src_page: vec2f,
    // output region's top-left inside its page (texels); device origin of it
    dst_off: vec2f,
    dst_origin: vec2f,
    // blurred input region in its page (texels) and the page size; device px
    // per blurred texel (2^n when the blur ran downsampled)
    blur_rect: vec4f,
    blur_page: vec2f,
    blur_scale: f32,
    // 1 = keep output only where the input had alpha (`clip`)
    clip: f32,
    // the node box in device px: centre x, y, width, height
    box: vec4f,
    // device px per logical px, seconds, extra texture size (texels)
    scale: f32,
    time: f32,
    aux_size: vec2f,
    // the node outline's distance field (effects whose packer asks for it):
    // device origin of texel (0,0), device px per texel, max distance (0 =
    // none); its size in texels
    field_rect: vec4f,
    field_size: vec2f,
    field_pad: vec2f,
    // the effect's parameters, 64 floats, laid out by its port (definePort)
    p: array<vec4f, 16>,
    // device px to the node's own box uv, as rows [x, y, 1]·xyz; w is the
    // box's size in logical px along that row's axis
    node: array<vec4f, 2>,
}

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var blur_tex: texture_2d<f32>;
@group(0) @binding(2) var aux_tex: texture_2d<f32>;
@group(0) @binding(3) var samp_linear: sampler;
@group(0) @binding(4) var samp_nearest: sampler;
@group(0) @binding(5) var<uniform> u: EffectU;
@group(0) @binding(6) var field_tex: texture_2d<f32>;

// Positional reads, for the generated `param_<name>()` accessors (gen/) only.
fn param(i: u32) -> f32 {
    return u.p[i / 4u][i % 4u];
}

fn param2(i: u32) -> vec2f {
    return vec2f(param(i), param(i + 1u));
}

fn param4(i: u32) -> vec4f {
    return vec4f(param(i), param(i + 1u), param(i + 2u), param(i + 3u));
}

fn box_center() -> vec2f { return u.box.xy; }
fn box_size() -> vec2f { return u.box.zw; }
fn box_half() -> vec2f { return u.box.zw * 0.5; }
fn box_origin() -> vec2f { return u.box.xy - u.box.zw * 0.5; }

fn sample_region(tex: texture_2d<f32>, rect: vec4f, page: vec2f, t: vec2f, clamp_edge: bool, nearest: bool) -> vec4f {
    var q = t;
    if (clamp_edge) {
        q = clamp(q, vec2f(0.5), rect.zw - 0.5);
    } else if (any(q < vec2f(0.0)) || any(q > rect.zw)) {
        return vec4f(0.0);
    }
    let uv = (rect.xy + q) / page;
    if (nearest) {
        return textureSampleLevel(tex, samp_nearest, uv, 0.0);
    }
    return textureSampleLevel(tex, samp_linear, uv, 0.0);
}

/// The effect's input at device position `p` (premultiplied), sampled as the
/// effect file declares (TILE_CLAMP, FILTER_NEAREST).
fn src(p: vec2f) -> vec4f {
    return sample_region(src_tex, u.src_rect, u.src_page, p - u.src_origin, TILE_CLAMP, FILTER_NEAREST);
}

/// Same, with an explicit tile/filter choice.
fn src_with(p: vec2f, clamp_edge: bool, nearest: bool) -> vec4f {
    return sample_region(src_tex, u.src_rect, u.src_page, p - u.src_origin, clamp_edge, nearest);
}

/// The blurred input (decal, bilinear) at device position `p`.
fn blurred(p: vec2f) -> vec4f {
    return sample_region(blur_tex, u.blur_rect, u.blur_page, (p - u.src_origin) / u.blur_scale, false, false);
}

/// The node outline's inside distance field at device position `p`: device
/// px to the outline, 0 outside (decal, bilinear, as the engine's half-float
/// field image). Only for effects whose packer sets `field`.
fn field(p: vec2f) -> f32 {
    let t = (p - u.field_rect.xy) / u.field_rect.z;
    if (any(t < vec2f(0.0)) || any(t > u.field_size)) {
        return 0.0;
    }
    return textureSampleLevel(field_tex, samp_linear, t / u.field_size, 0.0).r * u.field_rect.w;
}

/// The deepest point inside the outline (device px); 0 when there is no field.
fn max_distance() -> f32 { return u.field_rect.w; }

/// The effect's extra texture (LUT, noise, atlas) at texel position `t`.
fn aux_texel(t: vec2f, nearest: bool) -> vec4f {
    let uv = t / max(u.aux_size, vec2f(1.0));
    if (nearest) {
        return textureSampleLevel(aux_tex, samp_nearest, uv, 0.0);
    }
    return textureSampleLevel(aux_tex, samp_linear, uv, 0.0);
}

/// A colour-matrix filter: a 4×5 row-major matrix (20 params from
/// `base`, an array field's `PARAM_<NAME>`) on straight colour, clamped,
/// re-premultiplied.
fn color_matrix(c: vec4f, base: u32) -> vec4f {
    let s = vec4f(unpremul(c), c.a);
    var o: vec4f;
    for (var r = 0u; r < 4u; r++) {
        let k = base + r * 5u;
        o[r] = param(k) * s.r + param(k + 1u) * s.g + param(k + 2u) * s.b + param(k + 3u) * s.a + param(k + 4u);
    }
    o = clamp(o, vec4f(0.0), vec4f(1.0));
    return premul(o.rgb, o.a);
}

/// Separable/non-separable blend modes (W3C), `src` over `dst`, both
/// premultiplied. Modes: 0 srcOver, 1 multiply, 2 screen, 3 overlay,
/// 4 darken, 5 lighten, 6 colorDodge, 7 colorBurn, 8 hardLight, 9 softLight,
/// 10 difference, 11 exclusion, 12 hue, 13 saturation, 14 color,
/// 15 luminosity, 16 plus.
fn blend_mode(mode: u32, src: vec4f, dst: vec4f) -> vec4f {
    if (mode == 0u) {
        return src + dst * (1.0 - src.a);
    }
    if (mode == 16u) {
        return min(src + dst, vec4f(1.0));
    }
    let cs = clamp(unpremul(src), vec3f(0.0), vec3f(1.0));
    let cb = clamp(unpremul(dst), vec3f(0.0), vec3f(1.0));
    let mixed = blend_fn_fx(mode, cb, cs);
    let rgb = src.rgb * (1.0 - dst.a) + dst.rgb * (1.0 - src.a) + src.a * dst.a * mixed;
    return vec4f(rgb, src.a + dst.a - src.a * dst.a);
}

fn lum_fx(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }
fn clip_color_fx(c: vec3f) -> vec3f {
    let l = lum_fx(c);
    let n = min(min(c.r, c.g), c.b);
    let x = max(max(c.r, c.g), c.b);
    var o = c;
    if (n < 0.0) { o = l + (o - l) * l / max(l - n, 1e-6); }
    if (x > 1.0) { o = l + (o - l) * (1.0 - l) / max(x - l, 1e-6); }
    return o;
}
fn set_lum_fx(c: vec3f, l: f32) -> vec3f { return clip_color_fx(c + (l - lum_fx(c))); }
fn sat_fx(c: vec3f) -> f32 { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
fn set_sat_fx(c: vec3f, s: f32) -> vec3f {
    let mx = max(max(c.r, c.g), c.b);
    let mn = min(min(c.r, c.g), c.b);
    if (mx <= mn) { return vec3f(0.0); }
    return (c - mn) * s / (mx - mn);
}
fn soft_light_fx(b: f32, s: f32) -> f32 {
    if (s <= 0.5) { return b - (1.0 - 2.0 * s) * b * (1.0 - b); }
    let d = select(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, b <= 0.25);
    return b + (2.0 * s - 1.0) * (d - b);
}
fn dodge_fx(b: f32, s: f32) -> f32 {
    if (b == 0.0) { return 0.0; }
    if (s >= 1.0) { return 1.0; }
    return min(1.0, b / (1.0 - s));
}
fn burn_fx(b: f32, s: f32) -> f32 {
    if (b >= 1.0) { return 1.0; }
    if (s <= 0.0) { return 0.0; }
    return 1.0 - min(1.0, (1.0 - b) / s);
}
fn hard_light_fx(b: f32, s: f32) -> f32 {
    if (s <= 0.5) { return b * 2.0 * s; }
    return 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0));
}
fn blend_fn_fx(mode: u32, cb: vec3f, cs: vec3f) -> vec3f {
    switch mode {
        case 1u: { return cb * cs; }
        case 2u: { return cb + cs - cb * cs; }
        case 3u: { return vec3f(hard_light_fx(cs.r, cb.r), hard_light_fx(cs.g, cb.g), hard_light_fx(cs.b, cb.b)); }
        case 4u: { return min(cb, cs); }
        case 5u: { return max(cb, cs); }
        case 6u: { return vec3f(dodge_fx(cb.r, cs.r), dodge_fx(cb.g, cs.g), dodge_fx(cb.b, cs.b)); }
        case 7u: { return vec3f(burn_fx(cb.r, cs.r), burn_fx(cb.g, cs.g), burn_fx(cb.b, cs.b)); }
        case 8u: { return vec3f(hard_light_fx(cb.r, cs.r), hard_light_fx(cb.g, cs.g), hard_light_fx(cb.b, cs.b)); }
        case 9u: { return vec3f(soft_light_fx(cb.r, cs.r), soft_light_fx(cb.g, cs.g), soft_light_fx(cb.b, cs.b)); }
        case 10u: { return abs(cb - cs); }
        case 11u: { return cb + cs - 2.0 * cb * cs; }
        case 12u: { return set_lum_fx(set_sat_fx(cs, sat_fx(cb)), lum_fx(cb)); }
        case 13u: { return set_lum_fx(set_sat_fx(cb, sat_fx(cs)), lum_fx(cb)); }
        case 14u: { return set_lum_fx(cs, lum_fx(cb)); }
        case 15u: { return set_lum_fx(cb, lum_fx(cs)); }
        default: { return cs; }
    }
}

fn unpremul(c: vec4f) -> vec3f {
    return select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
}

fn premul(rgb: vec3f, a: f32) -> vec4f {
    return vec4f(rgb * a, a);
}

struct EffectV {
    @builtin(position) pos: vec4f,
}

@vertex
fn vs_effect(@builtin(vertex_index) vi: u32) -> EffectV {
    let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
    var o: EffectV;
    o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

fn device_of(frag: vec2f) -> vec2f {
    return frag - u.dst_off + u.dst_origin;
}

@fragment
fn fs_effect(in: EffectV) -> @location(0) vec4f {
    let p = device_of(in.pos.xy);
    var o = effect(p);
    if (u.clip > 0.5) {
        o *= src(p).a;
    }
    return o;
}
