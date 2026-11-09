// Composites a finished offscreen layer into its parent target, and the blur
// and final-blit passes. One module so they share the bind group layout:
// group(1) = source texture, backdrop texture, sampler, per-draw uniform.

struct Viewport {
    size: vec2f,
    origin: vec2f,
    // where this region starts inside its atlas texture
    offset: vec2f,
    pad: vec2f,
    flags: vec4u,
}

struct Comp {
    // destination rectangle in device px
    dst: vec4f,
    // uv rectangle of the source content inside its (pooled) texture
    uv: vec4f,
    // premultiplied-ready tint colour (unpremultiplied sRGB) for shadows
    tint: vec4f,
    // opacity, blend mode, tint on, unused
    params: vec4f,
    // backdrop texture origin (device px)
    back: vec4f,
    // uv rectangle of the mask region (params.w = mask mode)
    mask: vec4f,
}

@group(0) @binding(0) var<uniform> vp: Viewport;

struct Clip {
    region: vec4f,
    atlas: vec4f,
    link: vec4u,
}
@group(0) @binding(6) var clip_atlas: texture_2d_array<f32>;
@group(0) @binding(7) var<storage, read> clips: array<Clip>;

// Clip mask at the fragment (`back.z` = clip index + 1, 0 = none).
fn clip_value(frag: vec2f) -> f32 {
    let clip = u32(cu.back.z);
    if (clip == 0u) {
        return 1.0;
    }
    let device = frag - vp.offset + vp.origin;
    let c = clips[clip - 1u];
    if (any(device < c.region.xy) || any(device >= c.region.zw)) {
        return 0.0;
    }
    let texel = vec2i(c.atlas.xy + floor(device - c.region.xy));
    return textureLoad(clip_atlas, texel, i32(c.atlas.z), 0).r;
}

@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var backdrop: texture_2d<f32>;
@group(1) @binding(2) var samp: sampler;
@group(1) @binding(3) var<uniform> cu: Comp;
@group(1) @binding(4) var mask_tex: texture_2d<f32>;

struct VOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
    @location(1) t: vec2f,
}

@vertex
fn vs_comp(@builtin(vertex_index) vi: u32) -> VOut {
    let corner = vec2f(f32((0x32u >> vi) & 1u), f32((0x2Cu >> vi) & 1u));
    let d = mix(cu.dst.xy, cu.dst.zw, corner);
    let n = (d - vp.origin) / vp.size;
    var o: VOut;
    o.pos = vec4f(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
    o.uv = mix(cu.uv.xy, cu.uv.zw, corner);
    o.t = corner;
    return o;
}

fn srgb_to_linear(c: vec3f) -> vec3f {
    return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

// Mask modes: 1 alpha, 2 luminance, 3 inverted alpha, 4 inverted luminance,
// 5 inverted alpha eroded by one device px, 6 alpha dilated by one (a 3×3
// min / max: an erode / dilate of radius 1).
fn mask_value(t: vec2f) -> f32 {
    let mode = u32(cu.params.w);
    if (mode == 0u) {
        return 1.0;
    }
    let at = mix(cu.mask.xy, cu.mask.zw, t);
    if (mode >= 5u) {
        let texel = 1.0 / vec2f(textureDimensions(mask_tex));
        var lo = 1.0;
        var hi = 0.0;
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let a = textureSampleLevel(mask_tex, samp, at + vec2f(f32(x), f32(y)) * texel, 0.0).a;
                lo = min(lo, a);
                hi = max(hi, a);
            }
        }
        return select(hi, 1.0 - lo, mode == 5u);
    }
    let m = textureSampleLevel(mask_tex, samp, at, 0.0);
    var v = m.a;
    if (mode == 2u || mode == 4u) {
        v = dot(m.rgb, vec3f(0.2126, 0.7152, 0.0722));
    }
    if (mode >= 3u) {
        v = 1.0 - v;
    }
    return v;
}

fn source(uv: vec2f) -> vec4f {
    var c = textureSampleLevel(src, samp, uv, 0.0);
    if (cu.params.z > 0.5) {
        var t = cu.tint;
        if (vp.flags.x == 1u) {
            t = vec4f(srgb_to_linear(t.rgb), t.a);
        }
        c = vec4f(t.rgb * t.a, t.a) * c.a;
    }
    return c * cu.params.x;
}

@fragment
fn fs_comp(in: VOut) -> @location(0) vec4f {
    return source(in.uv) * mask_value(in.t) * clip_value(in.pos.xy);
}

// ── advanced (non-fixed-function) blend modes, W3C compositing formulas ──────

fn lum(c: vec3f) -> f32 {
    return dot(c, vec3f(0.3, 0.59, 0.11));
}

fn clip_color(c: vec3f) -> vec3f {
    let l = lum(c);
    let n = min(min(c.r, c.g), c.b);
    let x = max(max(c.r, c.g), c.b);
    var o = c;
    if (n < 0.0) {
        o = l + (o - l) * l / max(l - n, 1e-6);
    }
    if (x > 1.0) {
        o = l + (o - l) * (1.0 - l) / max(x - l, 1e-6);
    }
    return o;
}

fn set_lum(c: vec3f, l: f32) -> vec3f {
    return clip_color(c + (l - lum(c)));
}

fn sat(c: vec3f) -> f32 {
    return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

fn set_sat(c: vec3f, s: f32) -> vec3f {
    let mx = max(max(c.r, c.g), c.b);
    let mn = min(min(c.r, c.g), c.b);
    if (mx <= mn) {
        return vec3f(0.0);
    }
    return (c - mn) * s / (mx - mn);
}

fn soft_light(b: f32, s: f32) -> f32 {
    if (s <= 0.5) {
        return b - (1.0 - 2.0 * s) * b * (1.0 - b);
    }
    var d: f32;
    if (b <= 0.25) {
        d = ((16.0 * b - 12.0) * b + 4.0) * b;
    } else {
        d = sqrt(b);
    }
    return b + (2.0 * s - 1.0) * (d - b);
}

fn dodge(b: f32, s: f32) -> f32 {
    if (b == 0.0) { return 0.0; }
    if (s >= 1.0) { return 1.0; }
    return min(1.0, b / (1.0 - s));
}

fn burn(b: f32, s: f32) -> f32 {
    if (b >= 1.0) { return 1.0; }
    if (s <= 0.0) { return 0.0; }
    return 1.0 - min(1.0, (1.0 - b) / s);
}

fn hard_light(b: f32, s: f32) -> f32 {
    if (s <= 0.5) { return b * 2.0 * s; }
    return 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0));
}

fn blend_fn(mode: u32, cb: vec3f, cs: vec3f) -> vec3f {
    switch mode {
        case 1u: { return cb * cs; }
        case 2u: { return cb + cs - cb * cs; }
        case 3u: { return vec3f(hard_light(cs.r, cb.r), hard_light(cs.g, cb.g), hard_light(cs.b, cb.b)); }
        case 4u: { return min(cb, cs); }
        case 5u: { return max(cb, cs); }
        case 6u: { return vec3f(dodge(cb.r, cs.r), dodge(cb.g, cs.g), dodge(cb.b, cs.b)); }
        case 7u: { return vec3f(burn(cb.r, cs.r), burn(cb.g, cs.g), burn(cb.b, cs.b)); }
        case 8u: { return vec3f(hard_light(cb.r, cs.r), hard_light(cb.g, cs.g), hard_light(cb.b, cs.b)); }
        case 9u: { return vec3f(soft_light(cb.r, cs.r), soft_light(cb.g, cs.g), soft_light(cb.b, cs.b)); }
        case 10u: { return abs(cb - cs); }
        case 11u: { return cb + cs - 2.0 * cb * cs; }
        case 12u: { return set_lum(set_sat(cs, sat(cb)), lum(cb)); }
        case 13u: { return set_lum(set_sat(cb, sat(cs)), lum(cb)); }
        case 14u: { return set_lum(cs, lum(cb)); }
        case 15u: { return set_lum(cb, lum(cs)); }
        default: { return cs; }
    }
}

@fragment
fn fs_comp_advanced(in: VOut) -> @location(0) vec4f {
    let s = source(in.uv) * mask_value(in.t);
    let bp = vec2i(floor(in.pos.xy - vp.offset + vp.origin - cu.back.xy));
    let b = textureLoad(backdrop, bp, 0);
    let mode = u32(cu.params.y);
    if (mode == 16u) {
        return mix(b, min(s + b, vec4f(1.0)), clip_value(in.pos.xy));
    }
    let cs = select(vec3f(0.0), s.rgb / s.a, s.a > 0.0);
    let cb = select(vec3f(0.0), b.rgb / b.a, b.a > 0.0);
    let mixed = blend_fn(mode, clamp(cb, vec3f(0.0), vec3f(1.0)), clamp(cs, vec3f(0.0), vec3f(1.0)));
    let rgb = s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * mixed;
    let a = s.a + b.a - s.a * b.a;
    // This pass replaces pixels, so a clip blends back toward the backdrop.
    return mix(b, vec4f(rgb, a), clip_value(in.pos.xy));
}

// ── separable gaussian blur / 2x downsample ──────────────────────────────────
// Reuses Comp: dst.x = src px per dst px (scale), dst.zw = src content size,
// uv.xy = direction, uv.z = sigma, uv.w = radius in taps, tint.xy = src tex
// size, back.xy = dst region origin, back.zw = src region origin (atlas px).

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
    let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_blur(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let scale = cu.dst.x;
    let content = cu.dst.zw;
    let tex = cu.tint.xy;
    let dir = cu.uv.xy;
    let sigma = cu.uv.z;
    let radius = i32(cu.uv.w);
    let src0 = cu.back.zw;
    let center = (pos.xy - cu.back.xy) * scale + src0;
    if (radius == 0) {
        return textureSampleLevel(src, samp, center / tex, 0.0);
    }
    var acc = vec4f(0.0);
    var wsum = 0.0;
    for (var i = -radius; i <= radius; i++) {
        let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
        let p = center + dir * f32(i);
        wsum += w;
        // Decal: taps outside the content contribute transparent black.
        if (all(p >= src0) && all(p <= src0 + content)) {
            acc += w * textureSampleLevel(src, samp, p / tex, 0.0);
        }
    }
    return acc / wsum;
}

// ── final blit to the canvas / readback texture ──────────────────────────────

fn linear_to_srgb(c: vec3f) -> vec3f {
    return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

fn hash(p: vec2f) -> f32 {
    let q = fract(p * vec2f(0.1031, 0.1030));
    let r = q + dot(q, q.yx + 33.33);
    return fract((r.x + r.y) * r.x);
}

@fragment
fn fs_blit(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    var c = textureLoad(src, vec2i(floor(pos.xy)), 0);
    c = clamp(c, vec4f(0.0), vec4f(1.0));
    if (vp.flags.x == 1u) {
        let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
        c = vec4f(linear_to_srgb(rgb) * c.a, c.a);
    }
    if (vp.flags.y == 1u) {
        // Triangular-PDF dither of one 8-bit step: hides gradient banding.
        let n = hash(pos.xy) + hash(pos.xy + 17.17) - 1.0;
        c = vec4f(c.rgb + n / 255.0, c.a);
    }
    return c;
}
