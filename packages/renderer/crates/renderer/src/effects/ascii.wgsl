// ascii — one cell-centre tone read per cell
// (nearest), glyph from the baked one-row atlas (aux; linear, darkest first).
// glyphs: atlas glyph count; cell: atlas cell (texels).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn effect(p: vec2f) -> vec4f {
    let cell = max(param_size() * u.scale, 2.0);
    if (param_size() * u.scale < 2.0) { return src(p); }
    let from_origin = p - box_center();
    let index = floor(from_origin / cell);
    let cell_origin = box_center() + index * cell;
    let within = clamp((p - cell_origin) / cell, vec2f(0.0), vec2f(1.0));

    // Cell centres land on integers, a texel boundary: nudge so nearest picks the same texel every time.
    let s = src(cell_origin + cell * 0.5 + vec2f(0.01));
    if (s.a <= 0.0) { return vec4f(0.0); }
    let base = s.rgb / s.a;
    let tone = clamp(dot(base, LUMA), 0.0, 1.0);
    let ink4 = param_ink();
    let bg = param_background();
    let ramp = select(1.0 - tone, tone, dot(ink4.rgb, LUMA) >= dot(bg.rgb, LUMA));
    let count = param_glyphs();
    let glyph = clamp(floor(ramp * count), 0.0, count - 1.0);
    let ac = param_cell();
    let atlas_pos = vec2f((glyph + within.x) * ac, within.y * ac);
    let coverage = clamp(aux_texel(atlas_pos, false).r, 0.0, 1.0);

    let ink = select(ink4.rgb, base, param_colored() > 0.5);
    let straight = mix(bg.rgb, ink, coverage);
    let alpha = mix(bg.a, ink4.a, coverage) * s.a;
    return vec4f(straight * alpha, alpha);
}
