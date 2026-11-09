// chromaticAberration — a red ghost offset by +d and a blue ghost offset by −d, each a colour
// matrix over the shifted content, screened onto it in turn.
// offset: the fringe displacement (logical px).

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = false;

fn effect(p: vec2f) -> vec4f {
    let d = round(param_offset() * u.scale);
    let red = color_matrix(src(p - d), PARAM_RED);
    let blue = color_matrix(src(p + d), PARAM_BLUE);
    return blend_mode(2u, blue, blend_mode(2u, red, src(p)));
}
