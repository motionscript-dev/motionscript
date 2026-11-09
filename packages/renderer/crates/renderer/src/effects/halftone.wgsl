// halftone — tone becomes the area of a mark
// on a rotated grid; one tone per cell (a 2x2 quartile average), CMYK/RGB
// plates on their own angles. Grid anchored at the node centre.
// angle: radians; shape: 0 dot, 1 line, 2 cross; separation: 0 mono, 1 rgb,
// 2 cmyk (core's option order).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);
const ANGLE_A: f32 = 0.2617994;
const ANGLE_B: f32 = 1.3089969;
const ANGLE_C: f32 = 0.0;
const ANGLE_K: f32 = 0.7853982;

fn fmod2(x: vec2f, y: f32) -> vec2f {
    return x - y * floor(x / y);
}

// xy: offset from the cell centre in screen space; zw: that centre back in content space.
fn screen_cell(p: vec2f, offset: f32, pitch_in: f32) -> vec4f {
    let a = param_angle() + offset;
    let ca = cos(a);
    let sa = sin(a);
    let d = p - box_center();
    let q = vec2f(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    let pitch = max(pitch_in, 1.0);
    let h = pitch * 0.5;
    let cell = fmod2(q + h, pitch) - h;
    let qc = q - cell;
    let dc = vec2f(qc.x * ca + qc.y * sa, -qc.x * sa + qc.y * ca);
    return vec4f(cell, box_center() + dc);
}

fn cell_tone(centre: vec2f, offset: f32, fallback: vec3f, pitch: f32) -> vec3f {
    let a = param_angle() + offset;
    let ca = cos(a);
    let sa = sin(a);
    let o = max(pitch, 1.0) * 0.25;
    var sum = vec3f(0.0);
    var n = 0.0;
    for (var i = 0; i < 4; i++) {
        let t = vec2f(select(-o, o, i == 1 || i == 3), select(o, -o, i < 2));
        let d = vec2f(t.x * ca + t.y * sa, -t.x * sa + t.y * ca);
        let s = src(centre + d);
        if (s.a <= 0.0) { continue; }
        sum += s.rgb / s.a;
        n += 1.0;
    }
    return select(fallback, sum / max(n, 1.0), n > 0.0);
}

fn coverage(cell: vec2f, tone: f32, pitch_in: f32) -> f32 {
    let pitch = max(pitch_in, 1.0);
    let h = pitch * 0.5;
    let ink = 1.0 - clamp(tone, 0.0, 1.0);
    let aa = max(pitch * 0.08, 1.25);
    let shape = param_shape();
    if (shape < 0.5) {
        let radius = sqrt(ink) * h * 1.35;
        return 1.0 - smoothstep(radius - aa, radius + aa, length(cell));
    }
    let bar = ink * h;
    let horizontal = 1.0 - smoothstep(bar - aa, bar + aa, abs(cell.y));
    if (shape < 1.5) { return horizontal; }
    let vertical = 1.0 - smoothstep(bar - aa, bar + aa, abs(cell.x));
    return max(horizontal, vertical);
}

fn separate(base: vec3f) -> vec4f {
    let k = 1.0 - max(base.r, max(base.g, base.b));
    let inv = max(1.0 - k, 0.0001);
    let cmy = clamp((vec3f(1.0) - base - vec3f(k)) / inv, vec3f(0.0), vec3f(1.0));
    return vec4f(cmy, k);
}

fn effect(p: vec2f) -> vec4f {
    let c = src(p);
    let pitch = param_size() * u.scale;
    if (pitch < 1.0 || c.a <= 0.0) { return c; }
    let here = c.rgb / c.a;
    var screened: vec3f;
    let sep = param_separation();
    if (sep > 1.5) {
        let cc = screen_cell(p, ANGLE_A, pitch);
        let cm = screen_cell(p, ANGLE_B, pitch);
        let cy = screen_cell(p, ANGLE_C, pitch);
        let ck = screen_cell(p, ANGLE_K, pitch);
        let dc = coverage(cc.xy, 1.0 - separate(cell_tone(cc.zw, ANGLE_A, here, pitch)).x, pitch);
        let dm = coverage(cm.xy, 1.0 - separate(cell_tone(cm.zw, ANGLE_B, here, pitch)).y, pitch);
        let dy = coverage(cy.xy, 1.0 - separate(cell_tone(cy.zw, ANGLE_C, here, pitch)).z, pitch);
        let dk = coverage(ck.xy, 1.0 - separate(cell_tone(ck.zw, ANGLE_K, here, pitch)).w, pitch);
        screened = vec3f(1.0 - dc, 1.0 - dm, 1.0 - dy) * (1.0 - dk);
    } else if (sep > 0.5) {
        let cr = screen_cell(p, ANGLE_A, pitch);
        let cg = screen_cell(p, ANGLE_B, pitch);
        let cb = screen_cell(p, ANGLE_C, pitch);
        screened = vec3f(
            1.0 - coverage(cr.xy, cell_tone(cr.zw, ANGLE_A, here, pitch).r, pitch),
            1.0 - coverage(cg.xy, cell_tone(cg.zw, ANGLE_B, here, pitch).g, pitch),
            1.0 - coverage(cb.xy, cell_tone(cb.zw, ANGLE_C, here, pitch).b, pitch),
        );
    } else {
        let cell = screen_cell(p, ANGLE_C, pitch);
        screened = vec3f(1.0 - coverage(cell.xy, dot(cell_tone(cell.zw, ANGLE_C, here, pitch), LUMA), pitch));
    }
    return vec4f(clamp(screened, vec3f(0.0), vec3f(1.0)) * c.a, c.a);
}
