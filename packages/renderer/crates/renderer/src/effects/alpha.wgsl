// alpha — a media adjustment: a 4×5
// colour matrix on unpremultiplied colour, built by the packer as the engine does.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn effect(p: vec2f) -> vec4f {
    return color_matrix(src(p), PARAM_MATRIX);
}
