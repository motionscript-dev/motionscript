// grayscale — a colour matrix
// lerping identity → BT.709 luminance by `amount`.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn effect(p: vec2f) -> vec4f {
    return color_matrix(src(p), PARAM_MATRIX);
}
