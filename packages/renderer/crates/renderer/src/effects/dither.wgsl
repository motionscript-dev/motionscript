// dither — ordered Bayer (2/4/8) or a 64x64
// blue-noise tile (aux), cells counted from the node's top-left.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn bayer2(c: vec2f) -> f32 {
    let a = floor(c);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
}

fn effect(p: vec2f) -> vec4f {
    // The engine snapshots its source as 8-bit premultiplied; match that so levels
    // flip where it does (the work format here is half-float).
    let c = round(src(p) * 255.0) / 255.0;
    if (c.a <= 0.0) { return c; }
    let cell = floor((p - box_origin()) / max(param_scale() * u.scale, 1.0));
    var threshold: f32;
    if (param_noise() > 0.5) {
        let t = cell - 64.0 * floor(cell / 64.0);
        threshold = aux_texel(t + 0.5, true).r;
    } else if (param_matrix() < 3.0) {
        threshold = bayer2(cell);
    } else if (param_matrix() < 6.0) {
        threshold = bayer2(cell * 0.5) * 0.25 + bayer2(cell);
    } else {
        threshold = (bayer2(cell * 0.25) * 0.25 + bayer2(cell * 0.5)) * 0.25 + bayer2(cell);
    }
    var base = c.rgb / c.a;
    if (param_monochrome() > 0.5) { base = vec3f(dot(base, LUMA)); }
    let steps = max(param_levels(), 2.0) - 1.0;
    let dithered = clamp(floor(base * steps + threshold) / steps, vec3f(0.0), vec3f(1.0));
    return vec4f(dithered * c.a, c.a);
}
