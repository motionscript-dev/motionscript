// duotone — luminance remapped
// onto a shadows → highlights ramp, mixed by `amount`.

const TILE_CLAMP: bool = false;
const FILTER_NEAREST: bool = true;

fn effect(p: vec2f) -> vec4f {
    // The engine's layer is 8-bit premultiplied: quantise as it does before
    // un-premultiplying, so faint AA fringes resolve to the same colours.
    return color_matrix(round(src(p) * 255.0) / 255.0, PARAM_MATRIX);
}
