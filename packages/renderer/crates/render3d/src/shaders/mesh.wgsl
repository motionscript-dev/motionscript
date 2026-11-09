// Forward shading for every Scene3D drawable, ported from three.js r185's
// meshbasic / meshphysical / meshnormal / shadow / sprite programs: the same
// BRDF (GGX + DFG multiscatter), the same light loops, PCF shadows with the
// same Vogel/IGN kernel, then tone mapping -> sRGB encode -> fog, in three's
// order (fog mixes after encoding, as three does).
//
// Lighting runs in world space; three works in view space, which only
// changes rounding. geometryRoughness uses view-space normal derivatives as
// three does, since its per-component max isn't rotation invariant.

const PI: f32 = 3.141592653589793;
const RECIPROCAL_PI: f32 = 0.3183098861837907;
const EPSILON: f32 = 1e-6;
const MAX_LIGHTS: u32 = 16u;

struct LightU {
    // x kind (0 ambient, 1 hemisphere, 2 directional, 3 point, 4 spot, 5 area), y shadow slot or -1
    // (area: position = centre, direction = half width, ground = half height)
    info: vec4<f32>,
    color: vec4<f32>,
    ground: vec4<f32>,
    // world position (point, spot), or the direction towards the light (directional,
    // hemisphere; normalized)
    position: vec4<f32>,
    // spot: normalized direction from target to light
    direction: vec4<f32>,
    // distance, decay, coneCos, penumbraCos
    params: vec4<f32>,
};

struct ShadowU {
    matrix: mat4x4<f32>,
    // bias, normalBias, radius, mapSize
    params: vec4<f32>,
    // kind (0 2D map, 1 point cube), near, far, first array layer
    extra: vec4<f32>,
};

struct FrameU {
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    // world position; w = 1 for an orthographic camera
    camera: vec4<f32>,
    // world-space +Z of the camera (the view direction three uses when orthographic)
    camera_dir: vec4<f32>,
    ambient: vec4<f32>,
    // uniform environment radiance; w = 1 when present
    env: vec4<f32>,
    // rgb, w = kind (0 none, 1 linear, 2 exp2)
    fog: vec4<f32>,
    // near, far, density
    fog_params: vec4<f32>,
    // mapping, exposure, shadows on, light count
    tone: vec4<f32>,
    // width, height, 1/width, 1/height
    viewport: vec4<f32>,
    // transmission target width, height, present; w = 1: linear output
    // (the transmission pre-pass), no sRGB encode
    trans: vec4<f32>,
    lights: array<LightU, 16>,
    shadows: array<ShadowU, 4>,
};

struct DrawU {
    // linear rgb, opacity
    color: vec4<f32>,
    // linear rgb (times strength)
    emissive: vec4<f32>,
    // roughness, metalness, alphaTest, point size
    pbr: vec4<f32>,
    // x kind (0 basic, 1 standard, 2 normal, 3 shadow, 4 background, 5 phong,
    // 6 toon, 7 depth), y bits
    flags: vec4<u32>,
    // phong: specular (linear rgb), shininess
    spec: vec4<f32>,
    // the map's uv transform (three's Texture.matrix), rows of a 3x2
    map0: vec4<f32>,
    map1: vec4<f32>,
    // clearcoat, clearcoat roughness, transmission, thickness
    layer0: vec4<f32>,
    // ior, attenuation distance (-1 infinite), dashSize, gapSize
    layer1: vec4<f32>,
    // attenuation colour (linear), dash scale
    layer2: vec4<f32>,
};

const F_VERTEX_COLORS: u32 = 1u;
const F_FLAT: u32 = 2u;
const F_TONE_MAPPED: u32 = 4u;
const F_RECEIVE_SHADOW: u32 = 8u;
const F_FOG: u32 = 16u;
const F_INSTANCE_COLOR: u32 = 32u;
const F_OPAQUE: u32 = 64u;
const F_BILLBOARD: u32 = 128u;
const F_FLIP_SIDED: u32 = 256u;
const F_DOUBLE_SIDED: u32 = 512u;
const F_SIZE_ATTENUATION: u32 = 1024u;
const F_POINTS: u32 = 2048u;
const F_MAP: u32 = 4096u;
const F_MAP_FLIP_Y: u32 = 8192u;
const F_DASHED: u32 = 16384u;
const F_GRADIENT: u32 = 32768u;
const F_GRADIENT_FLIP_Y: u32 = 65536u;

@group(0) @binding(0) var<uniform> frame: FrameU;
@group(0) @binding(1) var dfg_tex: texture_2d<f32>;
@group(0) @binding(2) var lin_sampler: sampler;
@group(0) @binding(3) var shadow_tex: texture_depth_2d_array;
@group(0) @binding(4) var shadow_sampler: sampler_comparison;
@group(0) @binding(5) var trans_tex: texture_2d<f32>;
@group(0) @binding(6) var trans_sampler: sampler;
@group(1) @binding(0) var<uniform> draw: DrawU;
@group(2) @binding(0) var map_tex: texture_2d<f32>;
@group(2) @binding(1) var map_sampler: sampler;
@group(2) @binding(2) var grad_tex: texture_2d<f32>;
@group(2) @binding(3) var grad_sampler: sampler;

struct VsIn {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec3<f32>,
    @location(4) m0: vec4<f32>,
    @location(5) m1: vec4<f32>,
    @location(6) m2: vec4<f32>,
    @location(7) m3: vec4<f32>,
    @location(8) n0: vec4<f32>,
    @location(9) n1: vec4<f32>,
    @location(10) n2: vec4<f32>,
    @location(11) icolor: vec4<f32>,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) color: vec3<f32>,
    @location(3) uv: vec2<f32>,
    // -mvPosition.z
    @location(4) fog_depth: f32,
    // scale * lineDistance (dashed lines)
    @location(5) line_distance: f32,
    // the model matrix's axis lengths (transmission thickness)
    @location(6) model_scale: vec3<f32>,
};

fn has(bit: u32) -> bool {
    return (draw.flags.y & bit) != 0u;
}

@vertex
fn vs_main(v: VsIn) -> VsOut {
    let model = mat4x4<f32>(v.m0, v.m1, v.m2, v.m3);
    var out: VsOut;
    var world: vec4<f32>;
    var mv: vec4<f32>;
    if (has(F_BILLBOARD)) {
        // three's sprite.glsl: a quad facing the camera, scaled by the model's axes.
        mv = frame.view * model * vec4<f32>(0.0, 0.0, 0.0, 1.0);
        var scale = vec2<f32>(length(v.m0.xyz), length(v.m1.xyz));
        if (!has(F_SIZE_ATTENUATION) && frame.camera.w < 0.5) {
            scale = scale * -mv.z;
        }
        mv = vec4<f32>(mv.xy + v.position.xy * scale, mv.z, mv.w);
        world = vec4<f32>((model * vec4<f32>(0.0, 0.0, 0.0, 1.0)).xyz, 1.0);
    } else {
        world = model * vec4<f32>(v.position, 1.0);
        mv = frame.view * world;
    }
    out.clip = frame.proj * mv;
    if (has(F_POINTS)) {
        // points.glsl: a gl_PointSize square, attenuated by scale / -z.
        var size = draw.pbr.w;
        if (has(F_SIZE_ATTENUATION) && frame.camera.w < 0.5) {
            size = size * (frame.viewport.y * 0.5) / -mv.z;
        }
        out.clip = vec4<f32>(out.clip.xy + v.uv * size * 2.0 * frame.viewport.zw * out.clip.w, out.clip.zw);
    }
    out.world_pos = world.xyz;
    var n = mat3x3<f32>(v.n0.xyz, v.n1.xyz, v.n2.xyz) * v.normal;
    if (has(F_FLIP_SIDED)) {
        n = -n;
    }
    out.world_normal = n;
    var c = vec3<f32>(1.0);
    if (has(F_VERTEX_COLORS)) {
        c = v.color;
    }
    if (has(F_INSTANCE_COLOR)) {
        c = c * v.icolor.rgb;
    }
    out.color = c;
    out.uv = v.uv;
    out.fog_depth = -mv.z;
    // Line geometry carries its distance in normal.x (renderer.rs).
    out.line_distance = draw.layer2.w * v.normal.x;
    out.model_scale = vec3<f32>(length(v.m0.xyz), length(v.m1.xyz), length(v.m2.xyz));
    return out;
}

// A fullscreen triangle for an environment `background` (uniform, so one
// colour; three draws it first, without depth).
@vertex
fn vs_background(@builtin(vertex_index) i: u32) -> VsOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
    var out: VsOut;
    out.clip = vec4<f32>(p, 1.0, 1.0);
    out.world_pos = vec3<f32>(0.0);
    out.world_normal = vec3<f32>(0.0, 0.0, 1.0);
    out.color = vec3<f32>(1.0);
    out.uv = vec2<f32>(0.0);
    out.fog_depth = 0.0;
    out.line_distance = 0.0;
    out.model_scale = vec3<f32>(1.0);
    return out;
}

// ─── BRDF (lights_physical_pars_fragment) ───────────────────────────────────

fn pow2(x: f32) -> f32 { return x * x; }

fn f_schlick(f0: vec3<f32>, f90: f32, dot_vh: f32) -> vec3<f32> {
    let fresnel = exp2((-5.55473 * dot_vh - 6.98316) * dot_vh);
    return f0 * (1.0 - fresnel) + (f90 * fresnel);
}

fn v_ggx_smith_correlated(alpha: f32, dot_nl: f32, dot_nv: f32) -> f32 {
    let a2 = pow2(alpha);
    let gv = dot_nl * sqrt(a2 + (1.0 - a2) * pow2(dot_nv));
    let gl = dot_nv * sqrt(a2 + (1.0 - a2) * pow2(dot_nl));
    return 0.5 / max(gv + gl, EPSILON);
}

fn d_ggx(alpha: f32, dot_nh: f32) -> f32 {
    let a2 = pow2(alpha);
    let denom = pow2(dot_nh) * (a2 - 1.0) + 1.0;
    return RECIPROCAL_PI * a2 / pow2(denom);
}

struct Material {
    diffuse_color: vec3<f32>,
    diffuse_contribution: vec3<f32>,
    specular_color: vec3<f32>,
    specular_blended: vec3<f32>,
    roughness: f32,
    metalness: f32,
    specular_f90: f32,
};

fn dfg(roughness: f32, dot: f32) -> vec2<f32> {
    // GL samples the 16x16 LUT with (roughness, dotNV) in [0,1] over texel edges.
    return textureSampleLevel(dfg_tex, lin_sampler, vec2<f32>(roughness, dot), 0.0).rg;
}

fn brdf_ggx(l: vec3<f32>, v: vec3<f32>, n: vec3<f32>, m: Material) -> vec3<f32> {
    let alpha = pow2(m.roughness);
    let h = normalize(l + v);
    let dot_nl = saturate(dot(n, l));
    let dot_nv = saturate(dot(n, v));
    let dot_nh = saturate(dot(n, h));
    let dot_vh = saturate(dot(v, h));
    let f = f_schlick(m.specular_blended, m.specular_f90, dot_vh);
    return f * (v_ggx_smith_correlated(alpha, dot_nl, dot_nv) * d_ggx(alpha, dot_nh));
}

fn brdf_ggx_multiscatter(l: vec3<f32>, v: vec3<f32>, n: vec3<f32>, m: Material) -> vec3<f32> {
    let single = brdf_ggx(l, v, n, m);
    let dot_nl = saturate(dot(n, l));
    let dot_nv = saturate(dot(n, v));
    let dfg_v = dfg(m.roughness, dot_nv);
    let dfg_l = dfg(m.roughness, dot_nl);
    let fss_v = m.specular_blended * dfg_v.x + m.specular_f90 * dfg_v.y;
    let fss_l = m.specular_blended * dfg_l.x + m.specular_f90 * dfg_l.y;
    let ems_v = 1.0 - (dfg_v.x + dfg_v.y);
    let ems_l = 1.0 - (dfg_l.x + dfg_l.y);
    let favg = m.specular_blended + (1.0 - m.specular_blended) * 0.047619;
    let fms = fss_v * fss_l * favg / (1.0 - ems_v * ems_l * favg + EPSILON);
    return single + fms * (ems_v * ems_l);
}

struct Scatter {
    single: vec3<f32>,
    multi: vec3<f32>,
};

// bsdfs.glsl: Blinn-Phong as three's MeshPhongMaterial evaluates it.
fn brdf_blinn_phong(l: vec3<f32>, v: vec3<f32>, n: vec3<f32>, spec: vec3<f32>, shininess: f32) -> vec3<f32> {
    let h = normalize(l + v);
    let dot_nh = saturate(dot(n, h));
    let dot_vh = saturate(dot(v, h));
    let f = f_schlick(spec, 1.0, dot_vh);
    let d = RECIPROCAL_PI * (shininess * 0.5 + 1.0) * pow(dot_nh, shininess);
    return f * (0.25 * d);
}

fn multiscattering(n: vec3<f32>, v: vec3<f32>, spec: vec3<f32>, f90: f32, roughness: f32) -> Scatter {
    let dot_nv = saturate(dot(n, v));
    let fab = dfg(roughness, dot_nv);
    let fss_ess = spec * fab.x + f90 * fab.y;
    let ess = fab.x + fab.y;
    let ems = 1.0 - ess;
    let favg = spec + (1.0 - spec) * 0.047619;
    let fms = fss_ess * favg / (1.0 - ems * favg);
    return Scatter(fss_ess, fms * ems);
}

fn environment_brdf(n: vec3<f32>, v: vec3<f32>, spec: vec3<f32>, f90: f32, roughness: f32) -> vec3<f32> {
    let fab = dfg(roughness, saturate(dot(n, v)));
    return spec * fab.x + f90 * fab.y;
}

// BRDF_GGX_Clearcoat: F0 0.04, F90 1.
fn brdf_ggx_clearcoat(l: vec3<f32>, v: vec3<f32>, n: vec3<f32>, roughness: f32) -> vec3<f32> {
    let alpha = pow2(roughness);
    let h = normalize(l + v);
    let dot_nl = saturate(dot(n, l));
    let dot_nv = saturate(dot(n, v));
    let dot_nh = saturate(dot(n, h));
    let dot_vh = saturate(dot(v, h));
    let f = f_schlick(vec3<f32>(0.04), 1.0, dot_vh);
    return f * (v_ggx_smith_correlated(alpha, dot_nl, dot_nv) * d_ggx(alpha, dot_nh));
}

// ─── Rect area light (LTC_Evaluate with mInv = identity) ────────────────────
// As three without RectAreaLightUniformsLib.init(), whose LTC textures are
// empty: the specular term (Fresnel from ltc_2) is zero and the
// diffuse term needs no table, only the clipped polygon form factor.

fn ltc_edge_vector_form_factor(v1: vec3<f32>, v2: vec3<f32>) -> vec3<f32> {
    let x = dot(v1, v2);
    let y = abs(x);
    let a = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
    let b = 3.4175940 + (4.1616724 + y) * y;
    let v = a / b;
    var theta_sintheta = v;
    if (x <= 0.0) {
        theta_sintheta = 0.5 * inverseSqrt(max(1.0 - x * x, 1e-7)) - v;
    }
    return cross(v1, v2) * theta_sintheta;
}

fn ltc_diffuse(n: vec3<f32>, v: vec3<f32>, p: vec3<f32>, r0: vec3<f32>, r1: vec3<f32>, r2: vec3<f32>, r3: vec3<f32>) -> f32 {
    let light_normal = cross(r1 - r0, r3 - r0);
    if (dot(light_normal, p - r0) < 0.0) {
        return 0.0;
    }
    var t1 = v - n * dot(v, n);
    if (dot(t1, t1) < 1e-12) {
        // Any tangent: the form factor is symmetric about N.
        t1 = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9);
        t1 = t1 - n * dot(t1, n);
    }
    t1 = normalize(t1);
    let t2 = -cross(n, t1);
    let basis = transpose(mat3x3<f32>(t1, t2, n));
    let c0 = normalize(basis * (r0 - p));
    let c1 = normalize(basis * (r1 - p));
    let c2 = normalize(basis * (r2 - p));
    let c3 = normalize(basis * (r3 - p));
    let f = ltc_edge_vector_form_factor(c0, c1) + ltc_edge_vector_form_factor(c1, c2)
        + ltc_edge_vector_form_factor(c2, c3) + ltc_edge_vector_form_factor(c3, c0);
    // LTC_ClippedSphereFormFactor
    let l = length(f);
    return max((l * l + f.z) / (l + 1.0), 0.0);
}

// ─── Transmission (transmission_pars_fragment) ──────────────────────────────

fn w0(a: f32) -> f32 { return (1.0 / 6.0) * (a * (a * (-a + 3.0) - 3.0) + 1.0); }
fn w1(a: f32) -> f32 { return (1.0 / 6.0) * (a * a * (3.0 * a - 6.0) + 4.0); }
fn w2(a: f32) -> f32 { return (1.0 / 6.0) * (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0); }
fn w3(a: f32) -> f32 { return (1.0 / 6.0) * (a * a * a); }
fn g0(a: f32) -> f32 { return w0(a) + w1(a); }
fn g1(a: f32) -> f32 { return w2(a) + w3(a); }
fn h0(a: f32) -> f32 { return -1.0 + w1(a) / (w0(a) + w1(a)); }
fn h1(a: f32) -> f32 { return 1.0 + w3(a) / (w2(a) + w3(a)); }

fn bicubic(uv0: vec2<f32>, size: vec2<f32>, lod: f32) -> vec4<f32> {
    let texel = 1.0 / size;
    let uv = uv0 * size + 0.5;
    let iuv = floor(uv);
    let fuv = fract(uv);
    let g0x = g0(fuv.x);
    let g1x = g1(fuv.x);
    let h0x = h0(fuv.x);
    let h1x = h1(fuv.x);
    let h0y = h0(fuv.y);
    let h1y = h1(fuv.y);
    let p0 = (vec2<f32>(iuv.x + h0x, iuv.y + h0y) - 0.5) * texel;
    let p1 = (vec2<f32>(iuv.x + h1x, iuv.y + h0y) - 0.5) * texel;
    let p2 = (vec2<f32>(iuv.x + h0x, iuv.y + h1y) - 0.5) * texel;
    let p3 = (vec2<f32>(iuv.x + h1x, iuv.y + h1y) - 0.5) * texel;
    return g0(fuv.y) * (g0x * textureSampleLevel(trans_tex, trans_sampler, p0, lod) + g1x * textureSampleLevel(trans_tex, trans_sampler, p1, lod))
        + g1(fuv.y) * (g0x * textureSampleLevel(trans_tex, trans_sampler, p2, lod) + g1x * textureSampleLevel(trans_tex, trans_sampler, p3, lod));
}

fn texture_bicubic(uv: vec2<f32>, lod: f32) -> vec4<f32> {
    let levels = i32(textureNumLevels(trans_tex)) - 1;
    let lf = min(i32(floor(lod)), levels);
    let lc = min(i32(ceil(lod)), levels);
    let f_size = vec2<f32>(textureDimensions(trans_tex, lf));
    let c_size = vec2<f32>(textureDimensions(trans_tex, lc));
    let fs = bicubic(uv, f_size, f32(lf));
    let cs = bicubic(uv, c_size, f32(lc));
    return mix(fs, cs, fract(lod));
}

// ─── Shadows (shadowmap_pars_fragment, PCF) ─────────────────────────────────

fn interleaved_gradient_noise(p: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn vogel_disk_sample(i: i32, count: i32, phi: f32) -> vec2<f32> {
    let golden = 2.399963229728653;
    let r = sqrt((f32(i) + 0.5) / f32(count));
    let theta = f32(i) * golden + phi;
    return vec2<f32>(cos(theta), sin(theta)) * r;
}

// A point shadow's face for direction `d` (major axis, the renderer's
// CUBE_FACES order) and its uv there.
fn cube_face(d: vec3<f32>) -> vec3<f32> {
    let a = abs(d);
    var face: f32;
    var f: vec3<f32>;
    var up: vec3<f32>;
    if (a.x >= a.y && a.x >= a.z) {
        face = select(1.0, 0.0, d.x > 0.0);
        f = vec3<f32>(sign(d.x), 0.0, 0.0);
        up = vec3<f32>(0.0, 1.0, 0.0);
    } else if (a.y >= a.z) {
        face = select(3.0, 2.0, d.y > 0.0);
        f = vec3<f32>(0.0, sign(d.y), 0.0);
        up = vec3<f32>(0.0, 0.0, 1.0);
    } else {
        face = select(5.0, 4.0, d.z > 0.0);
        f = vec3<f32>(0.0, 0.0, sign(d.z));
        up = vec3<f32>(0.0, 1.0, 0.0);
    }
    let r = cross(f, up);
    let z = dot(d, f);
    let x = dot(d, r) / z;
    let y = dot(d, up) / z;
    return vec3<f32>(x * 0.5 + 0.5, 0.5 - y * 0.5, face);
}

fn get_shadow(slot: i32, world_pos: vec3<f32>, world_normal: vec3<f32>, frag: vec2<f32>) -> f32 {
    let s = frame.shadows[slot];
    let p = world_pos + world_normal * s.params.y;
    let phi = interleaved_gradient_noise(frag) * 2.0 * PI;
    let base = i32(s.extra.w);
    var sum = 0.0;
    if (s.extra.x > 0.5) {
        // getPointShadow: depth along the face's axis, offsets on the direction.
        let to_pos = p - s.matrix[3].xyz;
        let a = abs(to_pos);
        let vz = max(max(a.x, a.y), a.z);
        let near = s.extra.y;
        let far = s.extra.z;
        let dp = far * (vz - near) / (vz * (far - near)) + s.params.x;
        let bd = normalize(to_pos);
        let texel = s.params.z / s.params.w;
        let ab = abs(bd);
        var t = vec3<f32>(1.0, 0.0, 0.0);
        if (ab.x > ab.z) {
            t = vec3<f32>(0.0, 1.0, 0.0);
        }
        let tangent = normalize(cross(bd, t));
        let bitangent = cross(bd, tangent);
        for (var i = 0; i < 5; i = i + 1) {
            let o = vogel_disk_sample(i, 5, phi);
            let c = cube_face(bd + (tangent * o.x + bitangent * o.y) * texel);
            sum = sum + textureSampleCompareLevel(shadow_tex, shadow_sampler, c.xy, base + i32(c.z), dp);
        }
        if (vz <= far && vz >= near) {
            return sum * 0.2;
        }
        return 1.0;
    }
    var coord = s.matrix * vec4<f32>(p, 1.0);
    let c = coord.xyz / coord.w;
    let z = c.z + s.params.x;
    let in_frustum = c.x >= 0.0 && c.x <= 1.0 && c.y >= 0.0 && c.y <= 1.0;
    // Sample unconditionally (uniform control flow), select after.
    let radius = s.params.z / s.params.w;
    for (var i = 0; i < 5; i = i + 1) {
        let uv = c.xy + vogel_disk_sample(i, 5, phi) * radius;
        sum = sum + textureSampleCompareLevel(shadow_tex, shadow_sampler, uv, base, z);
    }
    if (in_frustum && z <= 1.0) {
        return sum * 0.2;
    }
    return 1.0;
}

// ─── Lights (lights_pars_begin) ─────────────────────────────────────────────

fn distance_attenuation(d: f32, cutoff: f32, decay: f32) -> f32 {
    var falloff = 1.0 / max(pow(d, decay), 0.01);
    if (cutoff > 0.0) {
        let r = d / cutoff;
        falloff = falloff * pow2(saturate(1.0 - r * r * r * r));
    }
    return falloff;
}

// ─── Tone mapping and output (tonemapping_pars_fragment, colorspace) ────────

fn rrt_and_odt_fit(v: vec3<f32>) -> vec3<f32> {
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

fn aces_filmic(c0: vec3<f32>, exposure: f32) -> vec3<f32> {
    let input_mat = mat3x3<f32>(
        vec3<f32>(0.59719, 0.07600, 0.02840),
        vec3<f32>(0.35458, 0.90834, 0.13383),
        vec3<f32>(0.04823, 0.01566, 0.83777),
    );
    let output_mat = mat3x3<f32>(
        vec3<f32>(1.60475, -0.10208, -0.00327),
        vec3<f32>(-0.53108, 1.10813, -0.07276),
        vec3<f32>(-0.07367, -0.00605, 1.07602),
    );
    var c = c0 * (exposure / 0.6);
    c = input_mat * c;
    c = rrt_and_odt_fit(c);
    c = output_mat * c;
    return saturate(c);
}

fn agx_contrast(x: vec3<f32>) -> vec3<f32> {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agx(c0: vec3<f32>, exposure: f32) -> vec3<f32> {
    let rec2020_to_srgb = mat3x3<f32>(
        vec3<f32>(1.6605, -0.1246, -0.0182),
        vec3<f32>(-0.5876, 1.1329, -0.1006),
        vec3<f32>(-0.0728, -0.0083, 1.1187),
    );
    let srgb_to_rec2020 = mat3x3<f32>(
        vec3<f32>(0.6274, 0.0691, 0.0164),
        vec3<f32>(0.3293, 0.9195, 0.0880),
        vec3<f32>(0.0433, 0.0113, 0.8956),
    );
    let inset = mat3x3<f32>(
        vec3<f32>(0.856627153315983, 0.137318972929847, 0.11189821299995),
        vec3<f32>(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
        vec3<f32>(0.0482516061458583, 0.101439036467562, 0.811302368396859),
    );
    let outset = mat3x3<f32>(
        vec3<f32>(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
        vec3<f32>(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
        vec3<f32>(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405),
    );
    let min_ev = -12.47393;
    let max_ev = 4.026069;
    var c = c0 * exposure;
    c = srgb_to_rec2020 * c;
    c = inset * c;
    c = max(c, vec3<f32>(1e-10));
    c = log2(c);
    c = (c - min_ev) / (max_ev - min_ev);
    c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    c = agx_contrast(c);
    c = outset * c;
    c = pow(max(vec3<f32>(0.0), c), vec3<f32>(2.2));
    c = rec2020_to_srgb * c;
    return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn neutral(c0: vec3<f32>, exposure: f32) -> vec3<f32> {
    let start = 0.8 - 0.04;
    let desat = 0.15;
    var c = c0 * exposure;
    let x = min(c.r, min(c.g, c.b));
    var offset = 0.04;
    if (x < 0.08) {
        offset = x - 6.25 * x * x;
    }
    c = c - offset;
    let peak = max(c.r, max(c.g, c.b));
    if (peak < start) {
        return c;
    }
    let d = 1.0 - start;
    let new_peak = 1.0 - d * d / (peak + d - start);
    c = c * (new_peak / peak);
    let g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0);
    return mix(c, vec3<f32>(new_peak), g);
}

fn tone_map(c: vec3<f32>) -> vec3<f32> {
    let mapping = u32(frame.tone.x);
    let e = frame.tone.y;
    switch mapping {
        case 1u: { return saturate(e * c); }
        case 2u: {
            let x = c * e;
            return saturate(x / (vec3<f32>(1.0) + x));
        }
        case 3u: {
            let x = max(vec3<f32>(0.0), c * e - 0.004);
            return pow((x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06), vec3<f32>(2.2));
        }
        case 4u: { return aces_filmic(c, e); }
        case 5u: { return agx(c, e); }
        case 6u: { return neutral(c, e); }
        default: { return c; }
    }
}

fn srgb_oetf(c: vec3<f32>) -> vec3<f32> {
    let hi = pow(c, vec3<f32>(0.41666)) * 1.055 - vec3<f32>(0.055);
    let lo = c * 12.92;
    return select(hi, lo, c <= vec3<f32>(0.0031308));
}

fn finish(rgb_in: vec3<f32>, alpha: f32, fog_depth: f32) -> vec4<f32> {
    var rgb = rgb_in;
    if (has(F_TONE_MAPPED) && frame.tone.x > 0.5) {
        rgb = tone_map(rgb);
    }
    if (frame.trans.w < 0.5) {
        rgb = srgb_oetf(rgb);
    }
    let fog_kind = frame.fog.w;
    if (has(F_FOG) && fog_kind > 0.5) {
        var factor: f32;
        if (fog_kind > 1.5) {
            let d = frame.fog_params.z;
            factor = 1.0 - exp(-d * d * fog_depth * fog_depth);
        } else {
            factor = smoothstep(frame.fog_params.x, frame.fog_params.y, fog_depth);
        }
        rgb = mix(rgb, frame.fog.rgb, factor);
    }
    return vec4<f32>(rgb, alpha);
}

// ─── Fragment ───────────────────────────────────────────────────────────────

@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    let kind = draw.flags.x;
    var diffuse = vec4<f32>(draw.color.rgb * in.color, draw.color.a);
    // map_fragment: diffuseColor *= texture(map, mapTransform * uv). Sampled
    // in uniform control flow; a draw without a map binds a white texel.
    var map_uv = vec2<f32>(dot(draw.map0.xyz, vec3<f32>(in.uv, 1.0)), dot(draw.map1.xyz, vec3<f32>(in.uv, 1.0)));
    if (has(F_MAP_FLIP_Y)) {
        map_uv.y = 1.0 - map_uv.y;
    }
    let texel = textureSample(map_tex, map_sampler, map_uv);
    if (has(F_MAP)) {
        diffuse = diffuse * texel;
    }
    if (has(F_DASHED)) {
        // linedashed.glsl: mod(vLineDistance, dashSize + gapSize) > dashSize.
        let total = draw.layer1.z + draw.layer1.w;
        let d = in.line_distance - total * floor(in.line_distance / total);
        if (d > draw.layer1.z) {
            discard;
        }
    }

    // Geometry normal (normal_fragment_begin). WGSL's dpdy runs down the
    // framebuffer, GL's up, hence the sign.
    var n: vec3<f32>;
    if (has(F_FLAT)) {
        n = -normalize(cross(dpdx(in.world_pos), dpdy(in.world_pos)));
    } else {
        n = normalize(in.world_normal);
        if (has(F_DOUBLE_SIDED) && !front) {
            n = -n;
        }
    }
    let view_n = (frame.view * vec4<f32>(n, 0.0)).xyz;
    let dxy = max(abs(dpdx(view_n)), abs(dpdy(view_n)));
    let geometry_roughness = max(max(dxy.x, dxy.y), dxy.z);
    if (diffuse.a < draw.pbr.z) {
        discard;
    }

    var shadow_mask = 1.0;
    var outgoing = diffuse.rgb;
    let light_count = u32(frame.tone.w);
    let shadows_on = frame.tone.z > 0.5 && has(F_RECEIVE_SHADOW);

    if (kind == 7u) {
        // meshdepth.glsl (BasicDepthPacking): 1 - gl_FragCoord.z, raw.
        return vec4<f32>(vec3<f32>(1.0 - in.clip.z), diffuse.a);
    }

    if (kind == 1u || kind == 5u || kind == 6u) {
        var v: vec3<f32>;
        if (frame.camera.w > 0.5) {
            v = frame.camera_dir.xyz;
        } else {
            v = normalize(frame.camera.xyz - in.world_pos);
        }
        let metal = draw.pbr.y;
        var m: Material;
        m.diffuse_color = diffuse.rgb;
        m.diffuse_contribution = diffuse.rgb * (1.0 - metal);
        m.metalness = metal;
        m.roughness = min(max(draw.pbr.x, 0.0525) + geometry_roughness, 1.0);
        let ior = draw.layer1.x;
        m.specular_color = vec3<f32>(0.04);
        if (ior != 1.5) {
            m.specular_color = vec3<f32>(min(pow2((ior - 1.0) / (ior + 1.0)), 1.0));
        }
        m.specular_blended = mix(m.specular_color, diffuse.rgb, metal);
        m.specular_f90 = 1.0;

        var direct_diffuse = vec3<f32>(0.0);
        var direct_specular = vec3<f32>(0.0);
        var irradiance = frame.ambient.rgb;
        let clearcoat = draw.layer0.x;
        let cc_roughness = min(max(draw.layer0.y, 0.0525) + geometry_roughness, 1.0);
        var cc_direct = vec3<f32>(0.0);

        for (var i = 0u; i < MAX_LIGHTS; i = i + 1u) {
            if (i >= light_count) {
                break;
            }
            let light = frame.lights[i];
            let lk = u32(light.info.x);
            if (lk == 1u) {
                let w = 0.5 * dot(n, light.position.xyz) + 0.5;
                irradiance = irradiance + mix(light.ground.rgb, light.color.rgb, w);
                continue;
            }
            if (lk == 5u) {
                // RE_Direct_RectArea_Physical: standard/physical only.
                if (kind == 1u) {
                    let c = light.position.xyz;
                    let hw = light.direction.xyz;
                    let hh = light.ground.xyz;
                    let ff = ltc_diffuse(n, v, in.world_pos, c + hw - hh, c - hw - hh, c - hw + hh, c + hw + hh);
                    direct_diffuse = direct_diffuse + light.color.rgb * m.diffuse_contribution * ff;
                }
                continue;
            }
            var l: vec3<f32>;
            var color = light.color.rgb;
            if (lk == 2u) {
                l = light.position.xyz;
            } else {
                let lv = light.position.xyz - in.world_pos;
                l = normalize(lv);
                let d = length(lv);
                if (lk == 4u) {
                    let angle_cos = dot(l, light.direction.xyz);
                    color = color * smoothstep(light.params.z, light.params.w, angle_cos);
                }
                color = color * distance_attenuation(d, light.params.x, light.params.y);
            }
            let slot = i32(light.info.y);
            if (shadows_on && slot >= 0 && any(color != vec3<f32>(0.0))) {
                color = color * get_shadow(slot, in.world_pos, n, in.clip.xy);
            }
            let dot_nl = saturate(dot(n, l));
            let irr = dot_nl * color;
            if (kind == 1u) {
                if (clearcoat > 0.0) {
                    cc_direct = cc_direct + irr * brdf_ggx_clearcoat(l, v, n, cc_roughness);
                }
                direct_specular = direct_specular + irr * brdf_ggx_multiscatter(l, v, n, m);
                direct_diffuse = direct_diffuse + irr * RECIPROCAL_PI * m.diffuse_contribution;
            } else if (kind == 6u) {
                // getGradientIrradiance: the gradient map's red at
                // (dotNL * 0.5 + 0.5, 0), or a 0.7 / 1.0 step anti-aliased by fwidth.
                let coord = dot(n, l) * 0.5 + 0.5;
                let fw = fwidth(coord) * 0.5;
                var gy = 0.0;
                if (has(F_GRADIENT_FLIP_Y)) {
                    gy = 1.0;
                }
                let g = textureSampleLevel(grad_tex, grad_sampler, vec2<f32>(coord, gy), 0.0).r;
                var step = mix(0.7, 1.0, smoothstep(0.7 - fw, 0.7 + fw, coord));
                if (has(F_GRADIENT)) {
                    step = g;
                }
                direct_diffuse = direct_diffuse + step * color * RECIPROCAL_PI * diffuse.rgb;
            } else {
                if (draw.spec.w > 0.0) {
                    direct_specular = direct_specular + irr * brdf_blinn_phong(l, v, n, draw.spec.rgb, draw.spec.w);
                }
                direct_diffuse = direct_diffuse + irr * RECIPROCAL_PI * diffuse.rgb;
            }
        }
        if (kind == 5u || kind == 6u) {
            // r185 gives Phong and Lambert the scene environment as diffuse
            // irradiance (lights_fragment_end: irradiance += iblIrradiance);
            // toon takes none.
            if (kind == 5u) {
                irradiance = irradiance + PI * frame.env.rgb;
            }
            outgoing = direct_diffuse + irradiance * RECIPROCAL_PI * diffuse.rgb + direct_specular + draw.emissive.rgb;
            return finish(outgoing, select(diffuse.a, 1.0, has(F_OPAQUE)), in.fog_depth);
        }

        let indirect_diffuse_amb = irradiance * RECIPROCAL_PI * m.diffuse_contribution;
        // Environment: three's PMREM of a uniform room is uniform, so the
        // irradiance and radiance lookups are both the constant radiance.
        let ibl_irradiance = PI * frame.env.rgb;
        let radiance = frame.env.rgb;
        let d = multiscattering(n, v, m.specular_color, m.specular_f90, m.roughness);
        let mm = multiscattering(n, v, m.diffuse_color, m.specular_f90, m.roughness);
        let single = mix(d.single, mm.single, metal);
        let multi = mix(d.multi, mm.multi, metal);
        let total_d = d.single + d.multi;
        let cos_w = ibl_irradiance * RECIPROCAL_PI;
        let indirect_specular = radiance * single + multi * cos_w;
        let indirect_diffuse = indirect_diffuse_amb + m.diffuse_contribution * (1.0 - total_d) * cos_w;

        var total_diffuse = direct_diffuse + indirect_diffuse;
        var alpha_t = 1.0;
        let transmission = draw.layer0.z;
        if (transmission > 0.0) {
            // transmission_fragment: refract through the thickness, sample the
            // opaque scene at the exit point with roughness-based lods.
            let tv = normalize(frame.camera.xyz - in.world_pos);
            let ray = normalize(refract(-tv, n, 1.0 / ior)) * draw.layer0.w * in.model_scale;
            let ndc = frame.proj * frame.view * vec4<f32>(in.world_pos + ray, 1.0);
            var uv = ndc.xy / ndc.w * 0.5 + 0.5;
            // GL's texture rows run up from the bottom, ours down from the top.
            uv.y = 1.0 - uv.y;
            let lod = log2(frame.trans.x) * m.roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
            let ts = texture_bicubic(uv, lod);
            var transmittance = m.diffuse_contribution;
            if (draw.layer1.y > 0.0) {
                let coeff = -log(draw.layer2.rgb) / draw.layer1.y;
                transmittance = transmittance * exp(-coeff * length(ray));
            }
            let f = environment_brdf(n, tv, m.specular_blended, m.specular_f90, m.roughness);
            let tf = (transmittance.r + transmittance.g + transmittance.b) / 3.0;
            let transmitted = vec4<f32>((1.0 - f) * transmittance * ts.rgb, 1.0 - (1.0 - ts.a) * tf);
            alpha_t = mix(1.0, transmitted.a, transmission);
            total_diffuse = mix(total_diffuse, transmitted.rgb, transmission);
        }
        outgoing = total_diffuse + direct_specular + indirect_specular + draw.emissive.rgb;
        if (clearcoat > 0.0) {
            let cc_indirect = radiance * environment_brdf(n, v, vec3<f32>(0.04), 1.0, cc_roughness);
            let fcc = f_schlick(vec3<f32>(0.04), 1.0, saturate(dot(n, v)));
            outgoing = outgoing * (1.0 - clearcoat * fcc) + (cc_direct + cc_indirect) * clearcoat;
        }
        diffuse.a = diffuse.a * alpha_t;
    } else if (kind == 2u) {
        // meshnormal.glsl writes the packed normal raw: no tone mapping,
        // colour space conversion or fog.
        var a = diffuse.a;
        if (has(F_OPAQUE)) {
            a = 1.0;
        }
        return vec4<f32>(normalize(view_n) * 0.5 + 0.5, a);
    } else if (kind == 3u) {
        if (frame.tone.z > 0.5 && has(F_RECEIVE_SHADOW)) {
            for (var i = 0u; i < MAX_LIGHTS; i = i + 1u) {
                if (i >= light_count) {
                    break;
                }
                let slot = i32(frame.lights[i].info.y);
                if (slot >= 0) {
                    shadow_mask = shadow_mask * get_shadow(slot, in.world_pos, n, in.clip.xy);
                }
            }
        }
        diffuse.a = diffuse.a * (1.0 - shadow_mask);
    } else if (kind == 4u) {
        outgoing = frame.env.rgb;
    }

    var alpha = diffuse.a;
    if (has(F_OPAQUE)) {
        alpha = 1.0;
    }
    return finish(outgoing, alpha, in.fog_depth);
}

