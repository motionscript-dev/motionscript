// Everything shape-like is an instanced quad with analytic coverage: rects,
// rounded rects, ellipses, their strokes, rrect shadows, and paths (any
// filled outline: fills, strokes, dashes, unions, cuts, glyphs). Colours are
// premultiplied on output; the target is single-sample Rgba16Float. Clips are
// coverage masks in the clip atlas, multiplied in per fragment.

struct Viewport {
    size: vec2f,
    origin: vec2f,
    // where this region starts inside its atlas texture
    offset: vec2f,
    pad: vec2f,
    // x: 1 = blend in linear light, y: dither on final blit
    flags: vec4u,
}

struct Prim {
    m: vec4f,
    t: vec4f,
    rect: vec4f,
    radii: vec4f,
    quad: vec4f,
    color: vec4f,
    info: vec4u,
    ext: vec4u,
}

struct Paint {
    head: vec4u,
    color: vec4f,
    geom: vec4f,
}

struct Stop {
    color: vec4f,
    offset: vec4f,
}

@group(0) @binding(0) var<uniform> vp: Viewport;
@group(0) @binding(1) var<storage, read> prims: array<Prim>;
@group(0) @binding(2) var<storage, read> paints: array<Paint>;
@group(0) @binding(3) var<storage, read> stops: array<Stop>;
// Path outlines: line segments (x0 y0 x1 y1, local units) and per-band lists
// of segment indices, headed by (start, count) pairs.
@group(0) @binding(4) var<storage, read> segs: array<vec4f>;
@group(0) @binding(5) var<storage, read> bands: array<u32>;

// Clip regions: device rect, atlas texel origin + layer, clip prim + parent.
struct Clip {
    region: vec4f,
    atlas: vec4f,
    link: vec4u,
}
@group(0) @binding(6) var clip_atlas: texture_2d_array<f32>;
@group(0) @binding(7) var<storage, read> clips: array<Clip>;

// The image an image paint samples (one per draw run; a 1×1 dummy otherwise).
@group(1) @binding(0) var image_tex: texture_2d<f32>;
@group(1) @binding(1) var image_samp: sampler;

const K_FILL_RRECT: u32 = 0u;
const K_FILL_ELLIPSE: u32 = 1u;
const K_STROKE_RRECT: u32 = 2u;
const K_STROKE_ELLIPSE: u32 = 3u;
const K_SHADOW_RRECT: u32 = 4u;
const K_PATH: u32 = 5u;
const PAINT_NONE: u32 = 0xffffffffu;
// info.x flag: the transform has a perspective row (prim.p isn't 0 0 1).
const PROJECTIVE: u32 = 0x100u;

struct VOut {
    @builtin(position) pos: vec4f,
    @location(0) local: vec2f,
    @location(1) @interpolate(flat) inst: u32,
}

// Homogeneous device position (x·w, y·w, w). Projective transforms keep w:
// the rasteriser then interpolates `local` perspective-correctly (coverage
// and paints are evaluated in local space through the inverse map per
// pixel) and clips the quad where it crosses w = 0.
// The perspective row g h i: 0 0 1 unless flagged PROJECTIVE, then packed
// in a slot the kind leaves unused (paths: rect.xyz, others: ext.xyz bits).
fn persp(pr: Prim) -> vec3f {
    if ((pr.info.x & PROJECTIVE) == 0u) {
        return vec3f(0.0, 0.0, 1.0);
    }
    if ((pr.info.x & 0xffu) == K_PATH) {
        return pr.rect.xyz;
    }
    return bitcast<vec3f>(pr.ext.xyz);
}

fn to_device(pr: Prim, p: vec2f) -> vec3f {
    let g = persp(pr);
    return vec3f(
        pr.m.x * p.x + pr.m.z * p.y + pr.t.x,
        pr.m.y * p.x + pr.m.w * p.y + pr.t.y,
        g.x * p.x + g.y * p.y + g.z,
    );
}

fn to_clip(d: vec3f) -> vec4f {
    let n = (d.xy - vp.origin * d.z) / vp.size;
    return vec4f(n.x * 2.0 - d.z, d.z - n.y * 2.0, 0.0, d.z);
}

@vertex
fn vs_quad(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
    let pr = prims[ii];
    let corner = vec2f(f32((0x32u >> vi) & 1u), f32((0x2Cu >> vi) & 1u));
    let local = mix(pr.quad.xy, pr.quad.zw, corner);
    var o: VOut;
    o.pos = to_clip(to_device(pr, local));
    o.local = local;
    o.inst = ii;
    return o;
}

// ── colour ───────────────────────────────────────────────────────────────────

fn srgb_to_linear(c: vec3f) -> vec3f {
    return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn working(c: vec4f) -> vec4f {
    if (vp.flags.x == 1u) {
        return vec4f(srgb_to_linear(c.rgb), c.a);
    }
    return c;
}

// Gradients interpolate unpremultiplied sRGB values.
// head.x = kind | tile << 8. Kinds: 0 solid, 1 linear, 2 radial, 3 sweep,
// 4 image. Tiles: 0 clamp, 1 repeat, 2 mirror, 3 decal. `dx`/`dy` are the
// local position's screen derivatives (taken in uniform control flow), for
// image mip selection.
fn eval_paint(id: u32, p: vec2f, dx: vec2f, dy: vec2f) -> vec4f {
    let pt = paints[id];
    let kind = pt.head.x & 0xffu;
    let tile = pt.head.x >> 8u;
    if (kind == 0u) {
        return working(pt.color);
    }
    if (kind == 10u) {
        return user_paint(pt, p, dx, dy);
    }
    if (kind >= 5u) {
        return procedural(kind, pt, p, dx, dy);
    }
    if (kind == 4u) {
        // geom = a b c d, color.xy = e f: local → normalized image uv.
        let a = pt.geom;
        var uv = vec2f(a.x * p.x + a.z * p.y + pt.color.x, a.y * p.x + a.w * p.y + pt.color.y);
        let ux = vec2f(a.x * dx.x + a.z * dx.y, a.y * dx.x + a.w * dx.y);
        let uy = vec2f(a.x * dy.x + a.z * dy.y, a.y * dy.x + a.w * dy.y);
        // The sampler repeats; anything but repeat keeps uv half a texel
        // inside the image so bilinear never wraps to the opposite edge.
        let half = 0.5 / vec2f(textureDimensions(image_tex, 0));
        if (tile == 2u) {
            uv = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
        } else if (tile == 3u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) {
            return vec4f(0.0);
        }
        if (tile != 1u) {
            uv = clamp(uv, half, 1.0 - half);
        }
        let c = textureSampleGrad(image_tex, image_samp, uv, ux, uy);
        // Stored premultiplied; paints hand back straight colour.
        let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
        return working(vec4f(rgb, c.a));
    }
    var t: f32;
    if (kind == 1u) {
        let d = pt.geom.zw - pt.geom.xy;
        t = dot(p - pt.geom.xy, d) / max(dot(d, d), 1e-12);
    } else if (kind == 2u) {
        t = length(p - pt.geom.xy) / max(pt.geom.z, 1e-6);
    } else {
        // Sweep: degrees clockwise from +x (y-down), mapped over [start, end].
        let q = p - pt.geom.xy;
        var deg = degrees(atan2(q.y, q.x));
        deg = select(deg, deg + 360.0, deg < 0.0);
        t = (deg - pt.geom.z) / max(pt.geom.w - pt.geom.z, 1e-6);
    }
    if (tile == 1u) {
        t = fract(t);
    } else if (tile == 2u) {
        t = 1.0 - abs(fract(t * 0.5) * 2.0 - 1.0);
    } else if (tile == 3u && (t < 0.0 || t > 1.0)) {
        return vec4f(0.0);
    }
    t = clamp(t, 0.0, 1.0);
    let n = pt.head.y;
    let s0 = pt.head.z;
    if (n == 0u) {
        return working(pt.color);
    }
    if (t <= stops[s0].offset.x) {
        return working(stops[s0].color);
    }
    for (var i = 1u; i < n; i++) {
        let a = stops[s0 + i - 1u];
        let b = stops[s0 + i];
        if (t <= b.offset.x) {
            let f = (t - a.offset.x) / max(b.offset.x - a.offset.x, 1e-6);
            return working(mix(a.color, b.color, f));
        }
    }
    return working(stops[s0 + n - 1u].color);
}

// ── procedural fills ─────────────────────────────────────────────────────────
// Each reads its parameters from the paint (color, geom) and the paint's
// "stops" used as raw vec4 parameter slots (P(k)); fractal noise's colour ramp
// follows its parameter slots. All positions are node-local logical px.

fn pslot(pt: Paint, k: u32) -> vec4f {
    return stops[pt.head.z + k].color;
}

fn coverage_out(c: vec4f, cover: f32) -> vec4f {
    // Straight colour with coverage folded into alpha (paints return straight).
    return vec4f(c.rgb, c.a * cover);
}

// dotGrid: geom = origin + offset (xy), spacing, radius.
fn dot_grid(pt: Paint, p: vec2f, feather: f32) -> vec4f {
    let radius = pt.geom.w;
    if (radius <= 0.0) {
        return vec4f(0.0);
    }
    let spacing = pt.geom.z;
    let q = p - pt.geom.xy;
    let d = (q - spacing * floor(q / spacing)) - spacing * 0.5;
    return coverage_out(working(pt.color), clamp((radius - length(d)) / feather + 0.5, 0.0, 1.0));
}

fn ruling(p: vec2f, pitch: vec2f, half_width: f32, feather: f32) -> f32 {
    if (half_width <= 0.0) {
        return 0.0;
    }
    let m = p - pitch * floor(p / pitch);
    let d = min(m, pitch - m);
    return clamp((half_width - min(d.x, d.y)) / feather + 0.5, 0.0, 1.0);
}

// grid: geom = origin + offset, size; P0 = divisions, subdivisions, half major, half minor.
fn grid_fill(pt: Paint, p: vec2f, feather: f32) -> vec4f {
    let a = pslot(pt, 0u);
    let q = p - pt.geom.xy;
    let major = max(pt.geom.zw / max(a.x, 0.0001), vec2f(0.01));
    let minor = major / max(a.y, 1.0);
    let cover = max(ruling(q, major, a.z, feather), ruling(q, minor, a.w, feather));
    return coverage_out(working(pt.color), cover);
}

// stripe: the engine bakes a gap×gap RGBA8 *unpremultiplied* tile with an AA
// vertical line over x ∈ [0, sw] (box coverage per texel; texels the line
// misses store rgb 0), filtered bilinearly before
// premultiplying — so colour and alpha both interpolate, and a half-covered
// sample is c·a·¼ premultiplied over a ½ alpha (a faint dark fringe).
// Rotated about the shape origin. geom = origin, gap, sw; P0 = cos, sin, origin x.
fn stripe_texel(x: i32, gap: f32, sw: f32, a: f32) -> f32 {
    let g = i32(gap);
    let xi = ((x % g) + g) % g;
    let x0 = f32(xi);
    let cover = clamp(min(x0 + 1.0, sw) - max(x0, 0.0), 0.0, 1.0);
    return round(cover * a * 255.0) / 255.0;
}

fn stripe_fill(pt: Paint, p: vec2f) -> vec4f {
    let a = pslot(pt, 0u);
    let gap = pt.geom.z;
    let sw = pt.geom.w;
    // Inverse of the engine's matrix (rotation about the origin applied to a
    // tile placed at 0,0): u = R⁻¹(p − o) + o.x.
    let d = p - pt.geom.xy;
    let u = a.x * d.x + a.y * d.y + a.z;
    // Bilinear across texel centres along the tile's x (lines are vertical).
    let t = u - 0.5;
    let i = i32(floor(t));
    let f = t - floor(t);
    let a0 = stripe_texel(i, gap, sw, pt.color.a);
    let a1 = stripe_texel(i + 1, gap, sw, pt.color.a);
    let rgb_w = mix(select(0.0, 1.0, a0 > 0.0), select(0.0, 1.0, a1 > 0.0), f);
    let c = working(vec4f(pt.color.rgb, 1.0));
    return vec4f(c.rgb * rgb_w, mix(a0, a1, f));
}

// noise: core's noise tile (hash2, bit-exact in u32),
// repeated at 1:1 px from the shape origin, nearest.
// geom = origin, tile w, h; P0 = cell x, cell y, density, seed; color = rgba8 / 255.
fn noise_hash(x: u32, y: u32, salt: u32) -> f32 {
    var v = ((x * 1664525u + 1013904223u) ^ (y * 1664525u * 1664525u + 1013904223u)) + salt;
    v ^= v >> 17u;
    v = v * 0x9e3779b9u;
    v ^= v >> 13u;
    v = v * 0x6c62272eu;
    v ^= v >> 16u;
    return f32(v) / 4294967296.0;
}

fn noise_fill(pt: Paint, p: vec2f) -> vec4f {
    let a = pslot(pt, 0u);
    let tile = pt.geom.zw;
    let q = floor(p - pt.geom.xy);
    let px = q - tile * floor(q / tile);
    let b = floor(px / max(a.xy, vec2f(1.0)));
    let seed = u32(i32(a.w));
    let rnd = noise_hash(u32(b.x), u32(b.y), seed);
    if (rnd >= a.z) {
        return vec4f(0.0);
    }
    let brightness = noise_hash(u32(b.x), u32(b.y), seed + 1u);
    let rgb = round(pt.color.rgb * 255.0 * brightness) / 255.0;
    return working(vec4f(rgb, pt.color.a));
}

// fractalNoise: fBm over value / simplex / ridged / worley, as fractal-noise.ts.
// geom = origin, size; P0 = frequency, offset; P1 = lacunarity, gain, seed,
// contrast; P2 = cos, sin, basis (0 value, 1 simplex, 2 ridged, 3 worley),
// octaves; then the colour ramp (stops from slot 3).
fn fn_hash2(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

fn fn_hash1(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn value_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let a = fn_hash1(i);
    let b = fn_hash1(i + vec2f(1.0, 0.0));
    let c = fn_hash1(i + vec2f(0.0, 1.0));
    let d = fn_hash1(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn simplex_noise(p: vec2f) -> f32 {
    let K1 = 0.366025404;
    let K2 = 0.211324865;
    let i = floor(p + (p.x + p.y) * K1);
    let a = p - (i - (i.x + i.y) * K2);
    let m = step(a.y, a.x);
    let o = vec2f(m, 1.0 - m);
    let b = a - o + K2;
    let c = a - 1.0 + 2.0 * K2;
    let h = max(0.5 - vec3f(dot(a, a), dot(b, b), dot(c, c)), vec3f(0.0));
    let g = vec3f(
        dot(a, fn_hash2(i) * 2.0 - 1.0),
        dot(b, fn_hash2(i + o) * 2.0 - 1.0),
        dot(c, fn_hash2(i + 1.0) * 2.0 - 1.0),
    );
    return dot(h * h * h * h * g, vec3f(70.0)) * 0.5 + 0.5;
}

fn worley_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    var best = 1.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let cell = vec2f(f32(x), f32(y));
            let point = fn_hash2(i + cell);
            best = min(best, length(cell + point - f));
        }
    }
    return best;
}

fn fractal_fill(pt: Paint, p: vec2f) -> vec4f {
    let a = pslot(pt, 0u);
    let b = pslot(pt, 1u);
    let c = pslot(pt, 2u);
    let uv = (p - pt.geom.xy) / max(pt.geom.zw, vec2f(1.0));
    let r = vec2f(uv.x * c.x - uv.y * c.y, uv.x * c.y + uv.y * c.x);
    var q = r * a.xy + a.zw + b.z;
    let basis = u32(c.z);
    let octaves = u32(c.w);
    var sum = 0.0;
    var amplitude = 1.0;
    var total = 0.0;
    var prev = 1.0;
    for (var o = 0u; o < min(octaves, 8u); o++) {
        var v: f32;
        if (basis == 2u) {
            var rr = 1.0 - abs(simplex_noise(q) * 2.0 - 1.0);
            rr = rr * rr * prev;
            prev = clamp(rr, 0.0, 1.0);
            v = rr;
        } else if (basis == 0u) {
            v = value_noise(q);
        } else if (basis == 3u) {
            v = worley_noise(q);
        } else {
            v = simplex_noise(q);
        }
        sum += v * amplitude;
        total += amplitude;
        amplitude *= b.y;
        q *= b.x;
    }
    var n = clamp(sum / max(total, 0.0001), 0.0, 1.0);
    n = clamp((n - 0.5) * b.w + 0.5, 0.0, 1.0);
    let s0 = pt.head.z + 3u;
    let count = pt.head.y - 3u;
    var col = stops[s0].color;
    for (var i = 1u; i < count; i++) {
        let lo = stops[s0 + i - 1u].offset.x;
        let hi = stops[s0 + i].offset.x;
        let t = clamp((n - lo) / max(hi - lo, 0.0001), 0.0, 1.0);
        col = mix(col, stops[s0 + i].color, step(lo, n) * t);
    }
    return working(col);
}

fn procedural(kind: u32, pt: Paint, p: vec2f, dx: vec2f, dy: vec2f) -> vec4f {
    // The engine's feather is one device px in logical px.
    let feather = max(0.5 * (length(dx) + length(dy)), 1e-4);
    switch kind {
        case 5u: { return dot_grid(pt, p, feather); }
        case 6u: { return grid_fill(pt, p, feather); }
        case 7u: { return stripe_fill(pt, p); }
        case 8u: { return noise_fill(pt, p); }
        default: { return fractal_fill(pt, p); }
    }
}

// A user (WGSL) fill, paint kind 10: drawn only by that fill's own pipeline,
// which replaces this function with a call to the author's `fill()`
// (user_shader.rs). Straight colour, like every paint.
fn user_paint(pt: Paint, p: vec2f, dx: vec2f, dy: vec2f) -> vec4f {
    return vec4f(0.0);
}

// ── distance fields ──────────────────────────────────────────────────────────

fn corner_radius(q: vec2f, r: vec4f) -> f32 {
    // r = tl, tr, br, bl in a y-down space
    let top = select(r.x, r.y, q.x > 0.0);
    let bottom = select(r.w, r.z, q.x > 0.0);
    return select(top, bottom, q.y > 0.0);
}

fn sd_rrect(q: vec2f, half: vec2f, r4: vec4f) -> f32 {
    let r = corner_radius(q, r4);
    let d = abs(q) - half + r;
    return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0) - r;
}

fn sd_ellipse(q: vec2f, ab: vec2f) -> f32 {
    // Gradient-normalised implicit distance; exact on the curve, which is all
    // the AA ramp needs.
    let k1 = length(q / ab);
    let k2 = length(q / (ab * ab));
    if (k2 < 1e-6) {
        return -min(ab.x, ab.y);
    }
    return k1 * (k1 - 1.0) / k2;
}

// Under a projective transform a pixel's local footprint is anisotropic and
// varies across the shape, so the AA ramp width is the screen-space gradient
// of the shape's distance: its local normal through the pixel's Jacobian
// (`ddx`, `ddy` = local units per device px). Affine prims keep `px`.
fn projective_px(pr: Prim, local: vec2f, ddx: vec2f, ddy: vec2f, px: f32) -> f32 {
    if ((pr.info.x & PROJECTIVE) == 0u) {
        return px;
    }
    let kind = pr.info.x & 0xffu;
    let c = (pr.rect.xy + pr.rect.zw) * 0.5;
    let half = (pr.rect.zw - pr.rect.xy) * 0.5;
    let q = local - c;
    var n: vec2f;
    if (kind == K_FILL_RRECT || kind == K_STROKE_RRECT || kind == K_SHADOW_RRECT) {
        let r = corner_radius(q, pr.radii);
        let d = abs(q) - half + r;
        if (d.x > 0.0 && d.y > 0.0) {
            n = normalize(d);
        } else if (d.x > d.y) {
            n = vec2f(1.0, 0.0);
        } else {
            n = vec2f(0.0, 1.0);
        }
    } else if (kind == K_FILL_ELLIPSE || kind == K_STROKE_ELLIPSE) {
        let g = abs(q) / max(half * half, vec2f(1e-6));
        if (dot(g, g) < 1e-12) {
            return px;
        }
        n = normalize(g);
    } else {
        return px;
    }
    // abs(q) folds the normal into the first quadrant; the Jacobian needs the
    // signed one.
    n *= select(vec2f(1.0), vec2f(-1.0), q < vec2f(0.0));
    return max(length(vec2f(dot(ddx, n), dot(ddy, n))), 1e-6);
}

fn cov(d: f32, px: f32) -> f32 {
    return clamp(0.5 - d / px, 0.0, 1.0);
}

fn grow(r: vec4f, w: f32) -> vec4f {
    return select(r + vec4f(w), vec4f(0.0), r <= vec4f(0.0));
}

// ── rounded-box gaussian shadow (after Evan Wallace) ─────────────────────────

fn erf2(x: vec2f) -> vec2f {
    let s = sign(x);
    let a = abs(x);
    var r = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
    r = r * r;
    return s - s / (r * r);
}

fn gaussian(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma)) / (2.5066283 * sigma);
}

fn shadow_x(x: f32, y: f32, sigma: f32, corner: f32, half: vec2f) -> f32 {
    let delta = min(half.y - corner - abs(y), 0.0);
    let curved = half.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
    let integral = 0.5 + 0.5 * erf2((x + vec2f(-curved, curved)) * (0.70710678 / sigma));
    return integral.y - integral.x;
}

fn rrect_shadow(q: vec2f, half: vec2f, r4: vec4f, sigma: f32) -> f32 {
    let corner = corner_radius(q, r4);
    let low = q.y - half.y;
    let high = q.y + half.y;
    let start = clamp(-3.0 * sigma, low, high);
    let end = clamp(3.0 * sigma, low, high);
    let step = (end - start) / 4.0;
    var y = start + step * 0.5;
    var v = 0.0;
    for (var i = 0; i < 4; i++) {
        v += shadow_x(q.x, q.y - y, sigma, corner, half) * gaussian(y, sigma) * step;
        y += step;
    }
    return v;
}

// ── path coverage ────────────────────────────────────────────────────────────
//
// Exact signed area of the pixel footprint (an axis-aligned box of `fw` local
// units around `p`) covered by the outline. For each segment crossing the
// footprint's y-range, integrate how much of each row lies left of it
// (winding along +x); summing over segments gives the winding-weighted area.
// Non-zero takes |area| clamped to 1, even-odd folds it. Segments come from
// the pixel's band only; bands overlap by more than a pixel.

// Average of clamp((x - x0) / w, 0, 1) along a segment spanning x in
// [xa, xb]. Split at the ramp's ends into pieces where it is linear and
// average those, so nothing large is subtracted (an earlier antiderivative
// form lost precision on near-vertical segments). Below 1e-3 px of span the
// midpoint is exact to that size.
fn seg_cov(xa: f32, xb: f32, x0: f32, w: f32) -> f32 {
    let lo = min(xa, xb);
    let hi = max(xa, xb);
    let d = hi - lo;
    if (d < 1e-3 * w) {
        return clamp((0.5 * (lo + hi) - x0) / w, 0.0, 1.0);
    }
    let a = clamp(x0, lo, hi);
    let b = clamp(x0 + w, lo, hi);
    let ramp = clamp((0.5 * (a + b) - x0) / w, 0.0, 1.0);
    return ((b - a) * ramp + (hi - b)) / d;
}

fn band_area(band_off: u32, band: u32, p: vec2f, fw: vec2f) -> f32 {
    let start = bands[band_off + band * 2u];
    let count = bands[band_off + band * 2u + 1u];
    let x0 = p.x - 0.5 * fw.x;
    let y0 = p.y - 0.5 * fw.y;
    let y1 = p.y + 0.5 * fw.y;
    var acc = 0.0;
    for (var i = 0u; i < count; i++) {
        var s = segs[bands[start + i]];
        var dir = 1.0;
        if (s.y > s.w) {
            s = vec4f(s.zw, s.xy);
            dir = -1.0;
        }
        let ya = max(s.y, y0);
        let yb = min(s.w, y1);
        if (yb <= ya) { continue; }
        let slope = (s.z - s.x) / (s.w - s.y);
        let xa = s.x + (ya - s.y) * slope;
        let xb = s.x + (yb - s.y) * slope;
        acc += dir * seg_cov(xa, xb, x0, fw.x) * (yb - ya);
    }
    return acc / fw.y;
}

fn fold(area: f32, even_odd: bool) -> f32 {
    let a = abs(area);
    if (even_odd) {
        let m = a - 2.0 * floor(a * 0.5);
        return 1.0 - abs(1.0 - m);
    }
    return min(a, 1.0);
}

fn path_coverage(pr: Prim, p: vec2f, fw: vec2f) -> f32 {
    let band_add = pr.ext.x;
    let n = pr.ext.y;
    let band = u32(clamp(floor((p.y - pr.radii.z) / pr.radii.w), 0.0, f32(n - 1u)));
    let even_odd = (pr.ext.z & 1u) == 1u;
    var c = fold(band_area(band_add, band, p, fw), even_odd);
    if (pr.ext.w != PAINT_NONE) {
        // A cut: subtract the second set's coverage.
        c *= 1.0 - fold(band_area(pr.ext.w, band, p, fw), false);
    }
    return c;
}

// ── fragment ─────────────────────────────────────────────────────────────────

fn shape_coverage(pr: Prim, local: vec2f, px: f32, fw: vec2f) -> f32 {
    let kind = pr.info.x & 0xffu;
    let c = (pr.rect.xy + pr.rect.zw) * 0.5;
    let half = (pr.rect.zw - pr.rect.xy) * 0.5;
    let q = local - c;
    switch kind {
        case K_FILL_RRECT: {
            return cov(sd_rrect(q, half, pr.radii), px);
        }
        case K_FILL_ELLIPSE: {
            return cov(sd_ellipse(q, half), px);
        }
        case K_STROKE_RRECT: {
            let w = pr.t.w * 0.5;
            let outer = cov(sd_rrect(q, half + w, grow(pr.radii, w)), px);
            let ih = half - w;
            var inner = 0.0;
            if (ih.x > 0.0 && ih.y > 0.0) {
                inner = cov(sd_rrect(q, ih, max(pr.radii - vec4f(w), vec4f(0.0))), px);
            }
            return clamp(outer - inner, 0.0, 1.0);
        }
        case K_STROKE_ELLIPSE: {
            let w = pr.t.w * 0.5;
            let outer = cov(sd_ellipse(q, half + w), px);
            let ih = half - w;
            var inner = 0.0;
            if (ih.x > 0.0 && ih.y > 0.0) {
                inner = cov(sd_ellipse(q, ih), px);
            }
            return clamp(outer - inner, 0.0, 1.0);
        }
        case K_PATH: {
            return path_coverage(pr, local, fw);
        }
        case K_SHADOW_RRECT: {
            let sigma = bitcast<f32>(pr.info.z);
            if (sigma < 0.05) {
                return cov(sd_rrect(q, half, pr.radii), px);
            }
            return rrect_shadow(q, half, pr.radii, sigma);
        }
        default: {
            return 1.0;
        }
    }
}

@fragment
fn fs_prim(in: VOut) -> @location(0) vec4f {
    // Local units per device pixel; taken before any branch (uniformity).
    let ddx = dpdx(in.local);
    let ddy = dpdy(in.local);
    let fw = max(fwidth(in.local), vec2f(1e-6));
    let px = length(fw) * 0.70710678;
    let pr = prims[in.inst];
    let coverage = shape_coverage(pr, in.local, projective_px(pr, in.local, ddx, ddy, max(px, 1e-6)), fw);
    var col: vec4f;
    if (pr.info.y == PAINT_NONE) {
        col = working(pr.color);
    } else {
        // Paths may sit at an offset from their node's paint space (glyphs
        // are placed by a translation; radii.xy is that offset).
        var paint_pos = in.local;
        if ((pr.info.x & 0xffu) == K_PATH) {
            paint_pos += pr.radii.xy;
        }
        col = eval_paint(pr.info.y, paint_pos, ddx, ddy);
    }
    let a = col.a * pr.t.z * coverage * clip_value(pr.info.w, device_pos(in.pos.xy));
    return vec4f(col.rgb * a, a);
}

// Clip mask value at a device position (`clip` = index + 1, 0 = none).
fn clip_value(clip: u32, device: vec2f) -> f32 {
    if (clip == 0u) {
        return 1.0;
    }
    let c = clips[clip - 1u];
    if (any(device < c.region.xy) || any(device >= c.region.zw)) {
        return 0.0;
    }
    let texel = vec2i(c.atlas.xy + floor(device - c.region.xy));
    return textureLoad(clip_atlas, texel, i32(c.atlas.z), 0).r;
}

fn device_pos(frag: vec2f) -> vec2f {
    return frag - vp.offset + vp.origin;
}

// ── clip mask pass ───────────────────────────────────────────────────────────
// One quad per clip over its atlas region. Each texel is the product of the
// clip shape's coverage and every ancestor's, evaluated at the texel's device
// position through the inverse of each shape's transform. Bound with a dummy
// clip atlas (this pass writes the real one).

struct MaskOut {
    @builtin(position) pos: vec4f,
    @location(0) device: vec2f,
    @location(1) @interpolate(flat) clip: u32,
}

@vertex
fn vs_clipmask(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MaskOut {
    let c = clips[ii];
    let corner = vec2f(f32((0x32u >> vi) & 1u), f32((0x2Cu >> vi) & 1u));
    let size = c.region.zw - c.region.xy;
    let atlas_px = c.atlas.xy + corner * size;
    let n = atlas_px / vp.size;
    var o: MaskOut;
    o.pos = vec4f(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
    o.device = c.region.xy + corner * size;
    o.clip = ii;
    return o;
}

fn shape_coverage_at(pr: Prim, device: vec2f) -> f32 {
    if ((pr.info.x & PROJECTIVE) != 0u) {
        return shape_coverage_projective(pr, device);
    }
    let det = pr.m.x * pr.m.w - pr.m.y * pr.m.z;
    if (abs(det) < 1e-12) {
        return 0.0;
    }
    let d = device - pr.t.xy;
    let local = vec2f(pr.m.w * d.x - pr.m.z * d.y, -pr.m.y * d.x + pr.m.x * d.y) / det;
    // Local units per device pixel, as fwidth would give.
    let fw = max(vec2f(abs(pr.m.w) + abs(pr.m.z), abs(pr.m.y) + abs(pr.m.x)) / abs(det), vec2f(1e-6));
    return shape_coverage(pr, local, length(fw) * 0.70710678, fw);
}

// The same through a projective transform: device → local by the inverse
// homography, and the local footprint of a device pixel from its Jacobian.
fn shape_coverage_projective(pr: Prim, device: vec2f) -> f32 {
    // Columns of H = [a c e / b d f / g h i].
    let g = persp(pr);
    let h = mat3x3f(
        vec3f(pr.m.x, pr.m.y, g.x),
        vec3f(pr.m.z, pr.m.w, g.y),
        vec3f(pr.t.x, pr.t.y, g.z),
    );
    let det = determinant(h);
    if (abs(det) < 1e-20) {
        return 0.0;
    }
    // Adjugate (inverse up to scale; the divide cancels it, the sign of w is
    // fixed by the forward map's w being positive in front of the eye).
    let c0 = h[0];
    let c1 = h[1];
    let c2 = h[2];
    let inv = transpose(mat3x3f(cross(c1, c2), cross(c2, c0), cross(c0, c1))) * (1.0 / det);
    let q = inv * vec3f(device, 1.0);
    if (q.z <= 0.0) {
        return 0.0;
    }
    let local = q.xy / q.z;
    // A local point behind the eye maps to this pixel only through w < 0.
    let w = g.x * local.x + g.y * local.y + g.z;
    if (w <= 0.0) {
        return 0.0;
    }
    let ddx = (inv[0].xy - local * inv[0].z) / q.z;
    let ddy = (inv[1].xy - local * inv[1].z) / q.z;
    let fw = max(abs(ddx) + abs(ddy), vec2f(1e-6));
    let px = projective_px(pr, local, ddx, ddy, max(length(fw) * 0.70710678, 1e-6));
    return shape_coverage(pr, local, px, fw);
}

@fragment
fn fs_clipmask(in: MaskOut) -> @location(0) vec4f {
    var cov = 1.0;
    var c = in.clip + 1u;
    for (var depth = 0; depth < 32 && c != 0u; depth++) {
        let info = clips[c - 1u];
        cov *= shape_coverage_at(prims[info.link.x], in.device);
        c = info.link.y;
    }
    return vec4f(cov, 0.0, 0.0, 1.0);
}
